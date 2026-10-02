// Limitatore di richieste: logica pura con orologio controllato, nessun DB né
// rete (per questo il file non importa aiuto.js). La prova HTTP con bcrypt e
// database è in registrazioneLimite.test.js.

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
    MESSAGGIO_429,
    chiaveIp,
    configurazioneRegistrazioneDaAmbiente,
    creaLimitatore,
    limitaRichieste,
} = require('../src/autenticazione/limiteRichieste');

const FINESTRA_MS = 900_000;

// Orologio che si muove solo quando lo si dice.
function orologio(inizio = 1_000_000) {
    let adesso = inizio;

    return {
        ora: () => adesso,
        avanza: ms => {
            adesso += ms;
        },
    };
}

function limitatore(massimo, { maxChiavi, orologio: o = orologio() } = {}) {
    return {
        orologio: o,
        l: creaLimitatore({
            massimo,
            finestraMs: FINESTRA_MS,
            maxChiavi,
            ora: o.ora,
        }),
    };
}

describe('soglia e finestra', () => {
    test('consente le prime N richieste e blocca la N+1 con Retry-After', () => {
        const { l } = limitatore(3);

        for (let i = 0; i < 3; i++) {
            assert.deepEqual(l.consuma('a'), { consentito: true });
        }

        assert.deepEqual(l.consuma('a'), {
            consentito: false,
            motivo: 'limite',
            retryAfterSec: 900,
        });
    });

    test('Retry-After scende con il tempo, arrotondato per eccesso, minimo 1', () => {
        const { l, orologio: o } = limitatore(1);

        l.consuma('a');
        o.avanza(100_500);
        assert.equal(l.consuma('a').retryAfterSec, 800); // 799,5 s -> 800
        o.avanza(FINESTRA_MS - 100_500 - 200);
        assert.equal(l.consuma('a').retryAfterSec, 1); // 0,2 s -> 1
    });

    test('le richieste bloccate non allungano né spostano la finestra', () => {
        const { l, orologio: o } = limitatore(2);

        l.consuma('a');
        l.consuma('a');
        o.avanza(10_000);

        const primo = l.consuma('a');
        for (let i = 0; i < 50; i++) {
            l.consuma('a');
        }
        const dopo = l.consuma('a');

        assert.equal(primo.retryAfterSec, 890);
        assert.equal(dopo.retryAfterSec, 890);
    });

    test('la finestra si azzera esattamente alla scadenza', () => {
        const { l, orologio: o } = limitatore(2);

        l.consuma('a');
        l.consuma('a');

        o.avanza(FINESTRA_MS - 1);
        assert.equal(l.consuma('a').consentito, false);

        o.avanza(1);
        assert.equal(l.consuma('a').consentito, true);
        assert.equal(l.consuma('a').consentito, true);
        // Il conteggio è ripartito da zero: il terzo è di nuovo bloccato.
        assert.equal(l.consuma('a').consentito, false);
    });

    test('chiavi diverse sono indipendenti', () => {
        const { l } = limitatore(1);

        assert.equal(l.consuma('a').consentito, true);
        assert.equal(l.consuma('a').consentito, false);
        assert.equal(l.consuma('b').consentito, true);
    });
});

describe('capacità: mai eliminare voci non scadute', () => {
    test('con la capacità piena di voci valide una chiave NUOVA è rifiutata (motivo capacita)', () => {
        const { l } = limitatore(5, { maxChiavi: 3 });

        l.consuma('a');
        l.consuma('b');
        l.consuma('c');

        const esito = l.consuma('nuova');

        assert.deepEqual(esito, {
            consentito: false,
            motivo: 'capacita',
            retryAfterSec: 900,
        });
        assert.equal(l.dimensione(), 3);
    });

    test('le chiavi già presenti continuano a essere contate, senza perdere il conto', () => {
        const { l } = limitatore(2, { maxChiavi: 2 });

        l.consuma('a');
        l.consuma('b');
        assert.equal(l.consuma('nuova').motivo, 'capacita');

        // "a" era a 1: ne restano ancora 1, poi il limite scatta come sempre.
        assert.equal(l.consuma('a').consentito, true);
        assert.equal(l.consuma('a').motivo, 'limite');
        assert.equal(l.dimensione(), 2);
    });

    test('si eliminano prima solo le scadute: le valide restano e il loro conto è intatto', () => {
        const { l, orologio: o } = limitatore(2, { maxChiavi: 3 });

        l.consuma('a'); // scade a t0 + 900 s
        o.avanza(10_000);
        l.consuma('b');
        l.consuma('b'); // b esaurita
        o.avanza(10_000);
        l.consuma('c');

        // Scade solo "a".
        o.avanza(FINESTRA_MS - 20_000 + 1);
        assert.equal(l.consuma('d').consentito, true);
        assert.equal(l.dimensione(), 3); // a tolta, b, c, d presenti

        // "b" non è stata toccata: è ancora esaurita.
        assert.equal(l.consuma('b').motivo, 'limite');

        // Ora b, c, d sono valide e la capacità è piena: "e" è rifiutata.
        assert.equal(l.consuma('e').motivo, 'capacita');
        assert.equal(l.dimensione(), 3);
    });

    test('Retry-After per capacità è la scadenza della voce più vecchia ancora valida', () => {
        const { l, orologio: o } = limitatore(5, { maxChiavi: 2 });

        l.consuma('a');
        o.avanza(30_000);
        l.consuma('b');
        o.avanza(30_000);

        // a scade tra 840 s, b tra 870 s.
        assert.equal(l.consuma('c').retryAfterSec, 840);
    });

    test('una voce scaduta che si rinnova va in coda: l\'ordine di scadenza resta valido', () => {
        const { l, orologio: o } = limitatore(5, { maxChiavi: 2 });

        l.consuma('a');
        o.avanza(10_000);
        l.consuma('b');

        // Scade "a" (t0 + 900 s), non "b" (t0 + 910 s): "a" si rinnova.
        o.avanza(FINESTRA_MS - 10_000 + 1);
        assert.equal(l.consuma('a').consentito, true);

        // Ora le più vecchie sono b (scade tra 9,999 s) e poi a (tra 900 s):
        // Retry-After segue "b", non la "a" appena rinnovata.
        const esito = l.consuma('c');
        assert.equal(esito.motivo, 'capacita');
        assert.equal(esito.retryAfterSec, 10);
    });

    test('dopo la scadenza di tutte le voci una chiave nuova torna possibile', () => {
        const { l, orologio: o } = limitatore(5, { maxChiavi: 2 });

        l.consuma('a');
        l.consuma('b');
        o.avanza(FINESTRA_MS);

        assert.equal(l.consuma('c').consentito, true);
    });
});

describe('pulisci', () => {
    test('toglie solo le voci scadute', () => {
        const { l, orologio: o } = limitatore(5);

        l.consuma('a');
        o.avanza(10_000);
        l.consuma('b');
        assert.equal(l.dimensione(), 2);

        o.avanza(FINESTRA_MS - 10_000);
        l.pulisci();
        assert.equal(l.dimensione(), 1); // "a" tolta, "b" valida

        o.avanza(10_000);
        l.pulisci();
        assert.equal(l.dimensione(), 0);
    });

    test('con voci tutte valide non toglie nulla', () => {
        const { l } = limitatore(5);

        l.consuma('a');
        l.consuma('b');
        l.pulisci();

        assert.equal(l.dimensione(), 2);
    });

    test('il timer di pulizia si avvia una volta e si ferma', () => {
        const { l } = limitatore(5);
        const timer = l.avviaPulizia();

        assert.equal(l.avviaPulizia(), timer);
        assert.equal(timer.hasRef(), false); // unref: non tiene vivo il processo
        l.fermaPulizia();
    });
});

describe('parametri non validi', () => {
    for (const [nome, parametri] of [
        ['massimo 0', { massimo: 0, finestraMs: 1000 }],
        ['massimo non intero', { massimo: 1.5, finestraMs: 1000 }],
        ['finestra 0', { massimo: 1, finestraMs: 0 }],
        ['finestra negativa', { massimo: 1, finestraMs: -5 }],
        ['maxChiavi 0', { massimo: 1, finestraMs: 1000, maxChiavi: 0 }],
        ['massimo assente', { finestraMs: 1000 }],
    ]) {
        test(nome, () => {
            assert.throws(() => creaLimitatore(parametri));
        });
    }
});

describe('chiaveIp', () => {
    test('IPv4 così com\'è', () => {
        assert.equal(chiaveIp('203.0.113.9'), '203.0.113.9');
    });

    test('IPv4 mappato in IPv6 (forma decimale ed esadecimale) coincide con l\'IPv4', () => {
        assert.equal(chiaveIp('::ffff:203.0.113.9'), '203.0.113.9');
        assert.equal(chiaveIp('::FFFF:203.0.113.9'), '203.0.113.9');
        assert.equal(chiaveIp('::ffff:7f00:1'), '127.0.0.1');
    });

    test('IPv6: stesso /64 stessa chiave, /64 diverso chiave diversa', () => {
        const a = chiaveIp('2001:db8:1:2::1');

        assert.equal(chiaveIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), a);
        assert.notEqual(chiaveIp('2001:db8:1:3::1'), a);
        assert.notEqual(chiaveIp('2001:db9:1:2::1'), a);
    });

    test('forme equivalenti dello stesso indirizzo IPv6', () => {
        const attesa = chiaveIp('2001:db8:1:2::1');

        assert.equal(chiaveIp('2001:0db8:0001:0002:0000:0000:0000:0001'), attesa);
        assert.equal(chiaveIp('2001:DB8:1:2::1'), attesa);
        assert.equal(chiaveIp('2001:db8:1:2::1%eth0'), attesa);
    });

    test('loopback e non specificato non si confondono con un IPv4', () => {
        assert.equal(chiaveIp('::1'), 'v6:0:0:0:0');
        assert.equal(chiaveIp('::'), 'v6:0:0:0:0');
    });

    test('IPv4 incorporato in IPv6 non mappato', () => {
        assert.equal(chiaveIp('64:ff9b::1.2.3.4'), 'v6:64:ff9b:0:0');
    });

    test('valore assente o non valido: una sola chiave "sconosciuto"', () => {
        for (const valore of [undefined, null, '', 'non-un-ip', 42]) {
            assert.equal(chiaveIp(valore), 'sconosciuto');
        }
    });
});

describe('middleware limitaRichieste', () => {
    function risposta() {
        const r = { intestazioni: {}, stato: null, corpo: null };

        r.set = (nome, valore) => {
            r.intestazioni[nome] = valore;
            return r;
        };
        r.status = codice => {
            r.stato = codice;
            return r;
        };
        r.json = corpo => {
            r.corpo = corpo;
            return r;
        };

        return r;
    }

    test('richiesta consentita: chiama next() e non risponde', () => {
        const { l } = limitatore(1);
        const res = risposta();
        let chiamate = 0;

        limitaRichieste(l)({ ip: '203.0.113.9' }, res, () => chiamate++);

        assert.equal(chiamate, 1);
        assert.equal(res.stato, null);
    });

    test('richiesta bloccata: 429, Retry-After, corpo generico, next() non chiamato', () => {
        const { l } = limitatore(1);
        const middleware = limitaRichieste(l);
        let chiamate = 0;

        middleware({ ip: '203.0.113.9' }, risposta(), () => chiamate++);
        const res = risposta();
        middleware({ ip: '203.0.113.9' }, res, () => chiamate++);

        assert.equal(chiamate, 1);
        assert.equal(res.stato, 429);
        assert.equal(res.intestazioni['Retry-After'], '900');
        assert.deepEqual(res.corpo, { messaggio: MESSAGGIO_429 });
    });

    test('la chiave è l\'IP del socket: due IP diversi non si influenzano', () => {
        const { l } = limitatore(1);
        const middleware = limitaRichieste(l);
        let chiamate = 0;

        middleware({ ip: '203.0.113.1' }, risposta(), () => chiamate++);
        middleware({ ip: '203.0.113.2' }, risposta(), () => chiamate++);

        assert.equal(chiamate, 2);
    });
});

describe('configurazione dall\'ambiente', () => {
    test('valori normali: 30 richieste ogni 900 secondi', () => {
        assert.deepEqual(configurazioneRegistrazioneDaAmbiente({}), {
            massimo: 30,
            finestraMs: 900_000,
        });
    });

    test('valori validi dall\'ambiente', () => {
        assert.deepEqual(
            configurazioneRegistrazioneDaAmbiente({
                RATE_LIMIT_REGISTRAZIONE_MAX: '1000',
                RATE_LIMIT_REGISTRAZIONE_FINESTRA_SEC: '60',
            }),
            { massimo: 1000, finestraMs: 60_000 },
        );
    });

    test('stringa vuota = valore normale', () => {
        assert.equal(
            configurazioneRegistrazioneDaAmbiente({
                RATE_LIMIT_REGISTRAZIONE_MAX: '',
            }).massimo,
            30,
        );
    });

    for (const valore of ['0', '-1', 'abc', '1.5', ' 5', '5 ', '1e3']) {
        test(`valore non valido "${valore}": errore, non ignorato in silenzio`, () => {
            assert.throws(() =>
                configurazioneRegistrazioneDaAmbiente({
                    RATE_LIMIT_REGISTRAZIONE_MAX: valore,
                }),
            );
            assert.throws(() =>
                configurazioneRegistrazioneDaAmbiente({
                    RATE_LIMIT_REGISTRAZIONE_FINESTRA_SEC: valore,
                }),
            );
        });
    }
});

describe('prenotazioni: rilascia e azzera agiscono solo sulla propria voce', () => {
    test('consuma mantiene la forma di sempre e non espone la prenotazione', () => {
        const { l } = limitatore(3);

        assert.deepEqual(l.consuma('a'), { consentito: true });
    });

    test('prenota restituisce la prenotazione, un blocco no', () => {
        const { l } = limitatore(1);

        const primo = l.prenota('a');
        assert.equal(primo.consentito, true);
        assert.equal(primo.prenotazione.chiave, 'a');

        const bloccato = l.prenota('a');
        assert.equal(bloccato.consentito, false);
        assert.ok(!('prenotazione' in bloccato));
    });

    test('rilascia toglie la propria unità e mai sotto zero', () => {
        const { l } = limitatore(5);

        const p1 = l.prenota('a').prenotazione;
        l.prenota('a');
        assert.equal(l.conteggio('a'), 2);

        l.rilascia(p1);
        assert.equal(l.conteggio('a'), 1);

        l.rilascia(p1);
        l.rilascia(p1);
        assert.equal(l.conteggio('a'), 0);
    });

    test('rilasciare una chiave non tocca le altre', () => {
        const { l } = limitatore(5);

        const a = l.prenota('a').prenotazione;
        l.prenota('b');
        l.rilascia(a);

        assert.equal(l.conteggio('a'), 0);
        assert.equal(l.conteggio('b'), 1);
    });

    test('azzera cancella la voce della prenotazione e libera la capacità', () => {
        const { l } = limitatore(5, { maxChiavi: 2 });

        const a = l.prenota('a').prenotazione;
        l.prenota('b');
        assert.equal(l.prenota('c').motivo, 'capacita');

        l.azzera(a);
        assert.equal(l.dimensione(), 1);
        assert.equal(l.prenota('c').consentito, true);
    });

    test('orologio finto: rilascia di una prenotazione della finestra scaduta non tocca la voce nuova', () => {
        const { l, orologio: o } = limitatore(5);

        const vecchia = l.prenota('a').prenotazione;
        o.avanza(FINESTRA_MS + 1);
        l.prenota('a'); // voce nuova, conteggio 1

        l.rilascia(vecchia);

        assert.equal(l.conteggio('a'), 1);
        assert.equal(l.dimensione(), 1);
    });

    test('orologio finto: azzera di una prenotazione della finestra scaduta non cancella la voce nuova', () => {
        const { l, orologio: o } = limitatore(5);

        const vecchia = l.prenota('a').prenotazione;
        o.avanza(FINESTRA_MS + 1);
        l.prenota('a');
        l.prenota('a'); // conteggio 2 nella finestra nuova

        l.azzera(vecchia);

        assert.equal(l.conteggio('a'), 2);
        assert.equal(l.dimensione(), 1);
    });

    test('voce scaduta e non ancora ripulita: il rilascio è innocuo e poi la chiave riparte da 1', () => {
        const { l, orologio: o } = limitatore(5);

        const vecchia = l.prenota('a').prenotazione;
        o.avanza(FINESTRA_MS + 1);

        l.rilascia(vecchia); // la voce è ancora nella mappa, ma scaduta
        assert.equal(l.conteggio('a'), 0);

        l.prenota('a');
        assert.equal(l.conteggio('a'), 1);
    });

    test('nella stessa finestra azzera e rilascia funzionano come prima', () => {
        const { l } = limitatore(2);

        const p = l.prenota('a').prenotazione;
        l.prenota('a');
        assert.equal(l.consuma('a').consentito, false);

        l.azzera(p);
        assert.equal(l.consuma('a').consentito, true);
        assert.equal(l.conteggio('a'), 1);
    });
});
