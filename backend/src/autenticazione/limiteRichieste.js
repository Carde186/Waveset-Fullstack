// Limitatore di richieste in memoria (finestra fissa, una chiave per IP).
//
// Conta OGNI richiesta che arriva, riuscita o no: serve a proteggere la CPU (un
// hash bcrypt per richiesta valida) e non guarda l'esito. Le richieste bloccate
// non vengono contate e non allungano la finestra.
//
// Limiti noti, da non nascondere:
// - I contatori sono in memoria: si azzerano al riavvio e non sono condivisi
//   tra più repliche del backend.
// - Finestra fissa: a cavallo del reset si può fare fino al doppio delle
//   richieste consentite in poco tempo.
// - Dietro un reverse proxy senza `trust proxy` tutti i client sembrano lo
//   stesso IP (quello del proxy). `trust proxy` è volutamente disattivato.

const net = require('node:net');

const MESSAGGIO_429 = 'Troppe richieste, riprova più tardi';
const MAX_CHIAVI_PREDEFINITO = 10000;
const CHIAVE_SCONOSCIUTA = 'sconosciuto';

function interoPositivo(valore, nome) {
    if (!Number.isInteger(valore) || valore < 1) {
        throw new Error(`${nome} deve essere un intero >= 1`);
    }
}

// Crea un limitatore. `ora` restituisce i millisecondi correnti: in produzione
// è Date.now, nei test un orologio controllato.
function creaLimitatore({
    massimo,
    finestraMs,
    maxChiavi = MAX_CHIAVI_PREDEFINITO,
    ora = Date.now,
}) {
    interoPositivo(massimo, 'massimo');
    interoPositivo(finestraMs, 'finestraMs');
    interoPositivo(maxChiavi, 'maxChiavi');

    // Le voci nascono con scadenza = adesso + finestra, quindi l'ordine di
    // inserimento della Map è anche l'ordine di scadenza. Una voce scaduta che
    // si rinnova viene cancellata e reinserita in coda, per non rompere
    // quell'ordine.
    const voci = new Map();
    let timer = null;

    // Toglie SOLO le voci scadute (mai quelle ancora valide) e si ferma alla
    // prima non scaduta, grazie all'ordine di scadenza.
    function pulisci() {
        const adesso = ora();

        for (const [chiave, voce] of voci) {
            if (voce.scadeAt > adesso) {
                break;
            }
            voci.delete(chiave);
        }
    }

    function secondiFinoA(scadeAt, adesso) {
        return Math.max(1, Math.ceil((scadeAt - adesso) / 1000));
    }

    // Registra una richiesta per la chiave e ne restituisce la PRENOTAZIONE:
    // { consentito: true, prenotazione } oppure { consentito: false, motivo,
    // retryAfterSec }, dove motivo è 'limite' (soglia superata) o 'capacita'
    // (vedi sotto). La prenotazione è legata alla voce e alla finestra in cui è
    // nata: rilascia() e azzera() agiscono solo su quella voce. Se nel frattempo
    // la finestra è scaduta e la chiave ha una voce nuova, la prenotazione
    // vecchia non la tocca (altrimenti si cancellerebbero fallimenti veri).
    function prenota(chiave) {
        const adesso = ora();
        let voce = voci.get(chiave);

        if (voce && voce.scadeAt <= adesso) {
            voci.delete(chiave);
            voce = undefined;
        }

        if (!voce) {
            if (voci.size >= maxChiavi) {
                pulisci();
            }

            // Capacità piena di voci ancora valide: comportamento
            // CONSERVATIVO. Non si toglie mai una voce non scaduta per fare
            // spazio (si perderebbe il conto di chi sta abusando): la
            // richiesta di una chiave NUOVA viene rifiutata finché non scade
            // la voce più vecchia. Le chiavi già presenti continuano a essere
            // contate normalmente.
            if (voci.size >= maxChiavi) {
                const [piuVecchia] = voci.values();

                return {
                    consentito: false,
                    motivo: 'capacita',
                    retryAfterSec: secondiFinoA(piuVecchia.scadeAt, adesso),
                };
            }

            voce = { conteggio: 0, scadeAt: adesso + finestraMs };
            voci.set(chiave, voce);
        }

        if (voce.conteggio >= massimo) {
            return {
                consentito: false,
                motivo: 'limite',
                retryAfterSec: secondiFinoA(voce.scadeAt, adesso),
            };
        }

        voce.conteggio += 1;
        return { consentito: true, prenotazione: { chiave, voce } };
    }

    // Come prenota(), senza esporre la prenotazione: per chi conta e basta
    // (per esempio la registrazione).
    function consuma(chiave) {
        const esito = prenota(chiave);

        return esito.consentito ? { consentito: true } : esito;
    }

    // Pulizia periodica; il timer non tiene vivo il processo (unref).
    function avviaPulizia() {
        if (timer === null) {
            timer = setInterval(pulisci, Math.max(1000, finestraMs));
            timer.unref();
        }
        return timer;
    }

    function fermaPulizia() {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    }

    // Restituisce la propria unità già contata (mai sotto zero). Serve a chi
    // conta PRIMA di conoscere l'esito (per non lasciar passare richieste
    // parallele durante l'attesa di bcrypt) e poi scarica ciò che non va
    // contato. Agisce SOLO se la voce della prenotazione è ancora quella della
    // chiave: se la finestra è scaduta e ne è nata una nuova, non fa nulla.
    function rilascia(prenotazione) {
        const { chiave, voce } = prenotazione;

        if (voci.get(chiave) === voce && voce.conteggio > 0) {
            voce.conteggio -= 1;
        }
    }

    // Cancella la voce della prenotazione (per esempio dopo un login
    // riuscito), solo se è ancora la voce corrente della chiave. Togliere una
    // voce non rompe l'ordine di scadenza delle altre.
    function azzera(prenotazione) {
        const { chiave, voce } = prenotazione;

        if (voci.get(chiave) === voce) {
            voci.delete(chiave);
        }
    }

    function conteggio(chiave) {
        const voce = voci.get(chiave);

        return voce && voce.scadeAt > ora() ? voce.conteggio : 0;
    }

    return {
        prenota,
        consuma,
        rilascia,
        azzera,
        conteggio,
        pulisci,
        avviaPulizia,
        fermaPulizia,
        dimensione: () => voci.size,
    };
}

// IPv6 -> quattro gruppi da 16 bit (il prefisso /64), scritti in forma
// canonica: un attaccante controlla in genere un intero /64.
function primiQuattroGruppiIpv6(indirizzo) {
    const [testa, coda] = indirizzo.split('::');
    const sinistra = testa ? testa.split(':') : [];
    const destra = coda === undefined ? [] : coda ? coda.split(':') : [];

    // Un eventuale IPv4 in coda (es. 64:ff9b::1.2.3.4) vale due gruppi.
    for (const parti of [sinistra, destra]) {
        const ultimo = parti[parti.length - 1];

        if (ultimo && ultimo.includes('.')) {
            const [a, b, c, d] = ultimo.split('.').map(Number);

            parti.splice(
                -1,
                1,
                ((a << 8) | b).toString(16),
                ((c << 8) | d).toString(16),
            );
        }
    }

    const zeri = coda === undefined ? 0 : 8 - sinistra.length - destra.length;
    const gruppi = [...sinistra, ...Array(zeri).fill('0'), ...destra];

    return gruppi.slice(0, 4).map(g => Number.parseInt(g, 16).toString(16));
}

// Chiave del limitatore per un indirizzo di socket: IPv4 così com'è, IPv4
// mappato in IPv6 come IPv4, IPv6 ridotto al prefisso /64.
function chiaveIp(indirizzo) {
    if (typeof indirizzo !== 'string' || indirizzo === '') {
        return CHIAVE_SCONOSCIUTA;
    }

    const senzaZona = indirizzo.split('%')[0].toLowerCase();
    const mappato = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(senzaZona);
    const mappatoEsadecimale = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(
        senzaZona,
    );
    let ip = senzaZona;

    if (mappato) {
        ip = mappato[1];
    } else if (mappatoEsadecimale) {
        // ::ffff:7f00:1 è 127.0.0.1: senza questo passaggio tutti gli
        // indirizzi mappati finirebbero nello stesso /64 (0:0:0:0).
        const alto = Number.parseInt(mappatoEsadecimale[1], 16);
        const basso = Number.parseInt(mappatoEsadecimale[2], 16);

        ip = [alto >> 8, alto & 255, basso >> 8, basso & 255].join('.');
    }

    if (net.isIPv4(ip)) {
        return ip;
    }
    if (net.isIPv6(ip)) {
        return `v6:${primiQuattroGruppiIpv6(ip).join(':')}`;
    }

    return CHIAVE_SCONOSCIUTA;
}

// Middleware Express: usa req.ip, che con `trust proxy` disattivato è
// l'indirizzo del socket (X-Forwarded-For viene ignorato). Va montato PRIMA di
// express.json() e del gestore, così una richiesta bloccata non paga né il
// parsing del corpo né la validazione né bcrypt.
function limitaRichieste(limitatore) {
    return function limita(req, res, next) {
        const esito = limitatore.consuma(chiaveIp(req.ip));

        if (!esito.consentito) {
            res.set('Retry-After', String(esito.retryAfterSec));
            res.status(429).json({ messaggio: MESSAGGIO_429 });
            return;
        }

        next();
    };
}

function leggiInteroPositivo(env, nome, predefinito) {
    const grezzo = env[nome];

    if (grezzo === undefined || grezzo === '') {
        return predefinito;
    }
    if (!/^\d+$/.test(grezzo) || Number(grezzo) < 1) {
        throw new Error(`${nome} deve essere un intero >= 1 (trovato "${grezzo}")`);
    }

    return Number(grezzo);
}

// Valori normali: 30 richieste per IP ogni 15 minuti. Si possono cambiare con
// RATE_LIMIT_REGISTRAZIONE_MAX e RATE_LIMIT_REGISTRAZIONE_FINESTRA_SEC; un
// valore non valido ferma l'avvio invece di essere ignorato in silenzio.
function configurazioneRegistrazioneDaAmbiente(env = process.env) {
    return {
        massimo: leggiInteroPositivo(env, 'RATE_LIMIT_REGISTRAZIONE_MAX', 30),
        finestraMs:
            leggiInteroPositivo(
                env,
                'RATE_LIMIT_REGISTRAZIONE_FINESTRA_SEC',
                900,
            ) * 1000,
    };
}

module.exports = {
    creaLimitatore,
    chiaveIp,
    limitaRichieste,
    leggiInteroPositivo,
    configurazioneRegistrazioneDaAmbiente,
    MESSAGGIO_429,
    MAX_CHIAVI_PREDEFINITO,
};
