// Limiti sul login bearer (/auth/login). Tre contatori per finestra, tutti in
// memoria e tutti controllati PRIMA di bcrypt:
//
//   totaleIp          tentativi TOTALI per IP (riusciti o no), mai rilasciato
//   fallimentiIp      fallimenti per IP
//   fallimentiCoppia  fallimenti per IP + email
//
// Ogni tentativo viene contato PRIMA di sapere l'esito e rilasciato dopo:
// - login riuscito: si azzera la coppia e si rilascia il contatore dei
//   fallimenti dell'IP (un successo non è un fallimento);
// - errore del server (es. database): si rilascia tutto, non è colpa del client.
// Contare prima e scaricare dopo impedisce che N richieste parallele passino
// tutte il controllo mentre bcrypt sta ancora calcolando.
//
// Nessun blocco permanente: ogni contatore scade con la sua finestra. Anche la
// password giusta, da una coppia o da un IP bloccati, riceve 429 fino alla
// scadenza. Con la capacità di un contatore piena di voci ancora valide il
// comportamento è conservativo: una chiave NUOVA riceve 429 (le voci valide non
// vengono mai eliminate); vale la stessa regola della registrazione.
//
// Limiti noti: contatori in memoria (si azzerano al riavvio, non condivisi tra
// repliche); finestra fissa; l'email nella chiave è solo trim + minuscolo, quindi
// varianti con accenti danno chiavi diverse (restano i tetti per IP).

const crypto = require('node:crypto');

const {
    chiaveIp,
    creaLimitatore,
    leggiInteroPositivo,
    MAX_CHIAVI_PREDEFINITO,
} = require('./limiteRichieste');

// Email normalizzata per la chiave: trim e minuscolo, NON si tolgono gli
// accenti. L'hash tiene la memoria limitata anche con email lunghissime.
function chiaveCoppiaLogin(ip, email) {
    return crypto
        .createHash('sha256')
        .update(`${ip}\n${email.trim().toLowerCase()}`)
        .digest('hex');
}

function creaLimiteLogin({
    coppiaMax,
    ipFallimentiMax,
    ipTotaleMax,
    finestraMs,
    maxChiavi = MAX_CHIAVI_PREDEFINITO,
    ora = Date.now,
}) {
    const comuni = { finestraMs, maxChiavi, ora };
    const totaleIp = creaLimitatore({ massimo: ipTotaleMax, ...comuni });
    const fallimentiIp = creaLimitatore({ massimo: ipFallimentiMax, ...comuni });
    const fallimentiCoppia = creaLimitatore({ massimo: coppiaMax, ...comuni });

    // Inizia un tentativo di login. Ritorna { consentito: false, motivo,
    // retryAfterSec } se un limite è raggiunto (nulla resta contato), oppure
    // { consentito: true, riuscito(), errore() }: dopo l'esito si chiama UNO
    // dei due; se il login fallisce con 401 non serve chiamare nulla.
    function inizia(indirizzo, email) {
        const ip = chiaveIp(indirizzo);
        const coppia = chiaveCoppiaLogin(ip, email);
        const passi = [
            [totaleIp, ip],
            [fallimentiIp, ip],
            [fallimentiCoppia, coppia],
        ];
        // Le prenotazioni sono legate alla voce (e quindi alla finestra) in cui
        // sono nate: un rilascio non tocca mai le voci di una finestra
        // successiva, né i fallimenti già contati da altri tentativi.
        const presi = [];

        for (const [limitatore, chiave] of passi) {
            const esito = limitatore.prenota(chiave);

            if (!esito.consentito) {
                // Il tentativo bloccato non deve restare contato altrove.
                for (const [l, prenotazione] of presi) {
                    l.rilascia(prenotazione);
                }
                return esito;
            }
            presi.push([limitatore, esito.prenotazione]);
        }

        const [, prenotazioneFallimentiIp] = presi[1];
        const [, prenotazioneCoppia] = presi[2];
        let chiuso = false;

        return {
            consentito: true,
            // Login riuscito: la coppia riparte e il contatore dei fallimenti
            // dell'IP perde SOLO la propria unità. I tentativi totali restano.
            riuscito() {
                if (!chiuso) {
                    chiuso = true;
                    fallimentiCoppia.azzera(prenotazioneCoppia);
                    fallimentiIp.rilascia(prenotazioneFallimentiIp);
                }
            },
            // Errore del server: nessun contatore deve tenere questo tentativo.
            errore() {
                if (!chiuso) {
                    chiuso = true;
                    for (const [l, prenotazione] of presi) {
                        l.rilascia(prenotazione);
                    }
                }
            },
        };
    }

    function avviaPulizia() {
        totaleIp.avviaPulizia();
        fallimentiIp.avviaPulizia();
        fallimentiCoppia.avviaPulizia();
    }

    function fermaPulizia() {
        totaleIp.fermaPulizia();
        fallimentiIp.fermaPulizia();
        fallimentiCoppia.fermaPulizia();
    }

    return {
        inizia,
        avviaPulizia,
        fermaPulizia,
        // Solo per i test: contatori correnti per un IP e una email.
        conteggi(indirizzo, email) {
            const ip = chiaveIp(indirizzo);

            return {
                totaleIp: totaleIp.conteggio(ip),
                fallimentiIp: fallimentiIp.conteggio(ip),
                fallimentiCoppia: fallimentiCoppia.conteggio(
                    chiaveCoppiaLogin(ip, email),
                ),
            };
        },
        dimensioni: () => ({
            totaleIp: totaleIp.dimensione(),
            fallimentiIp: fallimentiIp.dimensione(),
            fallimentiCoppia: fallimentiCoppia.dimensione(),
        }),
    };
}

// Valori normali: 10 fallimenti per IP+email, 50 fallimenti per IP e 100
// tentativi totali per IP, ogni 15 minuti. Un valore non valido ferma l'avvio.
function configurazioneLoginDaAmbiente(env = process.env) {
    return {
        coppiaMax: leggiInteroPositivo(env, 'RATE_LIMIT_LOGIN_COPPIA_MAX', 10),
        ipFallimentiMax: leggiInteroPositivo(
            env,
            'RATE_LIMIT_LOGIN_IP_FALLIMENTI_MAX',
            50,
        ),
        ipTotaleMax: leggiInteroPositivo(
            env,
            'RATE_LIMIT_LOGIN_IP_TOTALE_MAX',
            100,
        ),
        finestraMs:
            leggiInteroPositivo(env, 'RATE_LIMIT_LOGIN_FINESTRA_SEC', 900) *
            1000,
    };
}

module.exports = {
    creaLimiteLogin,
    configurazioneLoginDaAmbiente,
    chiaveCoppiaLogin,
};
