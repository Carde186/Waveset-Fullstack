// Limiti sul login: logica pura con orologio controllato, nessun DB né rete
// (per questo il file non importa aiuto.js). La prova HTTP con bcrypt e utenti
// veri è in loginLimite.test.js.
//
// Soglie di prova: 3 fallimenti per IP+email, 5 fallimenti per IP, 8 tentativi
// totali per IP.

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
    chiaveCoppiaLogin,
    configurazioneLoginDaAmbiente,
    creaLimiteLogin,
} = require('../src/autenticazione/limiteLogin');

const FINESTRA_MS = 900_000;
const IP = '203.0.113.10';
const ALTRO_IP = '203.0.113.20';
const EMAIL = 'utente@esempio.test';

function orologio(inizio = 1_000_000) {
    let adesso = inizio;

    return {
        ora: () => adesso,
        avanza: ms => {
            adesso += ms;
        },
    };
}

function limiti(sovrascritture = {}) {
    const o = orologio();

    return {
        o,
        l: creaLimiteLogin({
            coppiaMax: 3,
            ipFallimentiMax: 5,
            ipTotaleMax: 8,
            finestraMs: FINESTRA_MS,
            ora: o.ora,
            ...sovrascritture,
        }),
    };
}

describe('si conta PRIMA di conoscere l\'esito', () => {
    test('i primi N tentativi della coppia passano, il N+1 è bloccato anche senza esiti (richieste parallele)', () => {
        const { l } = limiti();

        for (let i = 0; i < 3; i++) {
            assert.equal(l.inizia(IP, EMAIL).consentito, true);
        }

        assert.deepEqual(l.inizia(IP, EMAIL), {
            consentito: false,
            motivo: 'limite',
            retryAfterSec: 900,
        });
    });

    test('un tentativo bloccato non resta contato negli altri contatori', () => {
        const { l } = limiti();

        for (let i = 0; i < 3; i++) {
            l.inizia(IP, EMAIL);
        }
        l.inizia(IP, EMAIL); // bloccato dalla coppia

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 3,
            fallimentiIp: 3,
            fallimentiCoppia: 3,
        });
    });

    test('un 401 non richiede nessuna chiamata: il tentativo resta contato come fallimento', () => {
        const { l } = limiti();

        l.inizia(IP, EMAIL); // esito: 401, nessun rilascio

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 1,
            fallimentiIp: 1,
            fallimentiCoppia: 1,
        });
    });
});

describe('esito riuscito o errore del server', () => {
    test('riuscito(): azzera la coppia e rilascia i fallimenti dell\'IP, non i tentativi totali', () => {
        const { l } = limiti();

        l.inizia(IP, EMAIL);
        l.inizia(IP, EMAIL);
        const terzo = l.inizia(IP, EMAIL);
        terzo.riuscito();

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 3,
            fallimentiIp: 2,
            fallimentiCoppia: 0,
        });
    });

    test('dopo un successo la coppia riparte da zero: 3 nuovi tentativi, il quarto è bloccato', () => {
        const { l } = limiti();

        l.inizia(IP, EMAIL);
        l.inizia(IP, EMAIL);
        l.inizia(IP, EMAIL).riuscito();

        for (let i = 0; i < 3; i++) {
            assert.equal(l.inizia(IP, EMAIL).consentito, true);
        }
        assert.equal(l.inizia(IP, EMAIL).consentito, false);
    });

    test('errore(): rilascia tutti e tre i contatori', () => {
        const { l } = limiti();

        l.inizia(IP, EMAIL).errore();

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 0,
            fallimentiIp: 0,
            fallimentiCoppia: 0,
        });
    });

    test('riuscito() ed errore() valgono una sola volta', () => {
        const { l } = limiti();
        const t = l.inizia(IP, EMAIL);

        t.riuscito();
        t.errore();
        t.riuscito();

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 1,
            fallimentiIp: 0,
            fallimentiCoppia: 0,
        });
    });
});

describe('un successo rilascia solo la propria prenotazione', () => {
    const EMAIL_A = 'a@esempio.test';
    const EMAIL_B = 'b@esempio.test';

    test('3 fallimenti dallo stesso IP su A, poi un successo su B: fallimenti IP ancora 3, totale IP 4', () => {
        const { l } = limiti();

        // Tre 401 su A: nessuna chiamata, i tentativi restano contati come fallimenti.
        for (let i = 0; i < 3; i++) {
            assert.equal(l.inizia(IP, EMAIL_A).consentito, true);
        }
        l.inizia(IP, EMAIL_B).riuscito();

        assert.deepEqual(l.conteggi(IP, EMAIL_A), {
            totaleIp: 4,
            fallimentiIp: 3,
            fallimentiCoppia: 3,
        });
        assert.deepEqual(l.conteggi(IP, EMAIL_B), {
            totaleIp: 4,
            fallimentiIp: 3,
            fallimentiCoppia: 0,
        });
    });

    test('il successo su B non toglie nulla nemmeno quando i fallimenti su A sono già oltre la soglia della coppia', () => {
        const { l } = limiti();

        for (let i = 0; i < 4; i++) {
            l.inizia(IP, EMAIL_A); // il quarto è bloccato dalla coppia
        }
        l.inizia(IP, EMAIL_B).riuscito();

        assert.equal(l.conteggi(IP, EMAIL_A).fallimentiIp, 3);
        assert.equal(l.conteggi(IP, EMAIL_A).fallimentiCoppia, 3);
        assert.equal(l.inizia(IP, EMAIL_A).consentito, false);
    });

    test('con orologio finto: una prenotazione della finestra scaduta non modifica la voce nuova (riuscito)', () => {
        const { l, o } = limiti();

        const vecchio = l.inizia(IP, EMAIL); // prenotato nella finestra 1
        o.avanza(FINESTRA_MS + 1); // la finestra 1 scade mentre "bcrypt calcola"
        l.inizia(IP, EMAIL); // fallimento della finestra 2: voci nuove

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 1,
            fallimentiIp: 1,
            fallimentiCoppia: 1,
        });

        vecchio.riuscito();

        // Le voci della finestra 2 restano intatte: il fallimento nuovo è ancora contato.
        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 1,
            fallimentiIp: 1,
            fallimentiCoppia: 1,
        });
    });

    test('con orologio finto: una prenotazione della finestra scaduta non modifica la voce nuova (errore)', () => {
        const { l, o } = limiti();

        const vecchio = l.inizia(IP, EMAIL);
        o.avanza(FINESTRA_MS + 1);
        l.inizia(IP, EMAIL);

        vecchio.errore();

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 1,
            fallimentiIp: 1,
            fallimentiCoppia: 1,
        });
    });

    test('nella stessa finestra la prenotazione rilascia invece proprio la sua unità', () => {
        const { l } = limiti();

        l.inizia(IP, EMAIL);
        const secondo = l.inizia(IP, EMAIL);
        secondo.errore();

        assert.deepEqual(l.conteggi(IP, EMAIL), {
            totaleIp: 1,
            fallimentiIp: 1,
            fallimentiCoppia: 1,
        });
    });
});

describe('isolamento tra email e tra IP', () => {
    test('la coppia bloccata non blocca un\'altra email dello stesso IP', () => {
        const { l } = limiti();

        for (let i = 0; i < 4; i++) {
            l.inizia(IP, EMAIL);
        }

        assert.equal(l.inizia(IP, 'altra@esempio.test').consentito, true);
    });

    test('la coppia bloccata non blocca la stessa email da un altro IP', () => {
        const { l } = limiti();

        for (let i = 0; i < 4; i++) {
            l.inizia(IP, EMAIL);
        }

        assert.equal(l.inizia(ALTRO_IP, EMAIL).consentito, true);
    });

    test('il limite non dipende dall\'esistenza dell\'email: stesso comportamento per qualunque indirizzo', () => {
        // Il limitatore non conosce il database: l'email può essere di un
        // utente vero o inventata, la sequenza degli esiti è la stessa.
        const esiti = ['esiste@esempio.test', 'non-esiste@esempio.test'].map(
            email => {
                const { l } = limiti();

                return [0, 1, 2, 3].map(() => l.inizia(IP, email).consentito);
            },
        );

        assert.deepEqual(esiti[0], [true, true, true, false]);
        assert.deepEqual(esiti[1], esiti[0]);
    });
});

describe('limite dei fallimenti per IP (5)', () => {
    test('con 5 fallimenti su email diverse, il tentativo successivo con QUALUNQUE email è bloccato', () => {
        const { l } = limiti();

        for (let i = 0; i < 5; i++) {
            assert.equal(l.inizia(IP, `u${i}@esempio.test`).consentito, true);
        }

        const bloccato = l.inizia(IP, 'nuova@esempio.test');
        assert.equal(bloccato.consentito, false);
        assert.equal(bloccato.motivo, 'limite');
        assert.equal(l.inizia(ALTRO_IP, EMAIL).consentito, true);
    });

    test('un login riuscito rilascia un fallimento dell\'IP', () => {
        const { l } = limiti();
        const primo = l.inizia(IP, 'u0@esempio.test');

        for (let i = 1; i < 5; i++) {
            l.inizia(IP, `u${i}@esempio.test`);
        }
        assert.equal(l.inizia(IP, 'x@esempio.test').consentito, false);

        primo.riuscito();
        assert.equal(l.inizia(IP, 'x@esempio.test').consentito, true);
        assert.equal(l.inizia(IP, 'y@esempio.test').consentito, false);
    });
});

describe('limite dei tentativi totali per IP (8)', () => {
    test('anche i login riusciti contano: il nono è bloccato con 0 fallimenti', () => {
        const { l } = limiti();

        for (let i = 0; i < 8; i++) {
            const t = l.inizia(IP, `u${i}@esempio.test`);
            assert.equal(t.consentito, true);
            t.riuscito();
        }

        assert.equal(l.conteggi(IP, EMAIL).fallimentiIp, 0);
        const bloccato = l.inizia(IP, 'nono@esempio.test');
        assert.equal(bloccato.consentito, false);
        assert.equal(bloccato.motivo, 'limite');
        assert.equal(l.inizia(ALTRO_IP, EMAIL).consentito, true);
    });
});

describe('finestra fissa, nessun blocco permanente', () => {
    test('Retry-After scende e la finestra si azzera alla scadenza', () => {
        const { l, o } = limiti();

        for (let i = 0; i < 3; i++) {
            l.inizia(IP, EMAIL);
        }
        assert.equal(l.inizia(IP, EMAIL).retryAfterSec, 900);

        o.avanza(899_000);
        assert.equal(l.inizia(IP, EMAIL).retryAfterSec, 1);

        o.avanza(1_000);
        assert.equal(l.inizia(IP, EMAIL).consentito, true);
        assert.equal(l.conteggi(IP, EMAIL).fallimentiCoppia, 1);
    });

    test('i tentativi bloccati non allungano la finestra', () => {
        const { l, o } = limiti();

        for (let i = 0; i < 3; i++) {
            l.inizia(IP, EMAIL);
        }
        o.avanza(10_000);

        const primo = l.inizia(IP, EMAIL).retryAfterSec;
        for (let i = 0; i < 30; i++) {
            l.inizia(IP, EMAIL);
        }

        assert.equal(primo, 890);
        assert.equal(l.inizia(IP, EMAIL).retryAfterSec, 890);
    });

    test('anche la password giusta è bloccata fino alla scadenza (il limite non guarda le credenziali)', () => {
        const { l, o } = limiti();

        for (let i = 0; i < 3; i++) {
            l.inizia(IP, EMAIL);
        }

        assert.equal(l.inizia(IP, EMAIL).consentito, false);
        o.avanza(FINESTRA_MS);
        assert.equal(l.inizia(IP, EMAIL).consentito, true);
    });
});

describe('chiave della coppia', () => {
    test('trim e minuscolo: le varianti di maiuscole e spazi sono la stessa coppia', () => {
        const { l } = limiti();

        l.inizia(IP, 'Utente@Esempio.TEST');
        l.inizia(IP, '  utente@esempio.test  ');
        l.inizia(IP, 'UTENTE@ESEMPIO.TEST');

        assert.equal(l.conteggi(IP, 'utente@esempio.test').fallimentiCoppia, 3);
        assert.equal(l.inizia(IP, 'utente@esempio.test ').consentito, false);
    });

    test('gli accenti NON vengono tolti: è un\'altra coppia', () => {
        assert.notEqual(
            chiaveCoppiaLogin(IP, 'jose@esempio.test'),
            chiaveCoppiaLogin(IP, 'josé@esempio.test'),
        );
    });

    test('è un hash esadecimale che non contiene l\'email e cambia con l\'IP', () => {
        const chiave = chiaveCoppiaLogin(IP, EMAIL);

        assert.match(chiave, /^[0-9a-f]{64}$/);
        assert.ok(!chiave.includes('utente'));
        assert.notEqual(chiave, chiaveCoppiaLogin(ALTRO_IP, EMAIL));
    });
});

describe('capacità piena: mai eliminare voci valide, blocco conservativo', () => {
    const GENEROSE = {
        coppiaMax: 100,
        ipFallimentiMax: 100,
        ipTotaleMax: 100,
        maxChiavi: 2,
    };

    test('un IP NUOVO con la capacità piena è bloccato (motivo capacita) e nulla resta contato', () => {
        const { l } = limiti(GENEROSE);

        l.inizia('203.0.113.1', EMAIL);
        l.inizia('203.0.113.2', EMAIL);

        const nuovo = l.inizia('203.0.113.3', EMAIL);
        assert.deepEqual(nuovo, {
            consentito: false,
            motivo: 'capacita',
            retryAfterSec: 900,
        });
        assert.deepEqual(l.dimensioni(), {
            totaleIp: 2,
            fallimentiIp: 2,
            fallimentiCoppia: 2,
        });
        assert.deepEqual(l.conteggi('203.0.113.3', EMAIL), {
            totaleIp: 0,
            fallimentiIp: 0,
            fallimentiCoppia: 0,
        });
    });

    test('una COPPIA nuova con la capacità piena è bloccata, la coppia già presente continua a contare', () => {
        const { l } = limiti(GENEROSE);

        l.inizia(IP, 'a@esempio.test');
        l.inizia(IP, 'b@esempio.test');

        const nuova = l.inizia(IP, 'c@esempio.test');
        assert.equal(nuova.consentito, false);
        assert.equal(nuova.motivo, 'capacita');
        // Rollback degli altri contatori: l'IP conta solo i due tentativi validi.
        assert.equal(l.conteggi(IP, 'a@esempio.test').totaleIp, 2);

        assert.equal(l.inizia(IP, 'a@esempio.test').consentito, true);
        assert.equal(l.conteggi(IP, 'a@esempio.test').fallimentiCoppia, 2);
    });

    test('si eliminano prima solo le scadute: le valide restano con il loro conto', () => {
        const { l, o } = limiti(GENEROSE);

        l.inizia('203.0.113.1', EMAIL); // scade a t0 + 900 s
        o.avanza(10_000);
        l.inizia('203.0.113.2', EMAIL);

        o.avanza(FINESTRA_MS - 10_000 + 1); // scade solo il primo IP
        assert.equal(l.inizia('203.0.113.3', EMAIL).consentito, true);

        // Il secondo IP è intatto e conta ancora il suo tentativo.
        assert.equal(l.conteggi('203.0.113.2', EMAIL).totaleIp, 1);
        assert.equal(l.conteggi('203.0.113.1', EMAIL).totaleIp, 0);

        // Ora due voci valide (ip2, ip3): un quarto IP è bloccato.
        assert.equal(l.inizia('203.0.113.4', EMAIL).motivo, 'capacita');
    });

    test('dopo la scadenza di tutte le voci un IP nuovo torna possibile', () => {
        const { l, o } = limiti(GENEROSE);

        l.inizia('203.0.113.1', EMAIL);
        l.inizia('203.0.113.2', EMAIL);
        assert.equal(l.inizia('203.0.113.3', EMAIL).consentito, false);

        o.avanza(FINESTRA_MS);
        assert.equal(l.inizia('203.0.113.3', EMAIL).consentito, true);
    });
});

describe('configurazione dall\'ambiente', () => {
    test('valori normali: 10 per coppia, 50 fallimenti e 100 tentativi per IP, 900 s', () => {
        assert.deepEqual(configurazioneLoginDaAmbiente({}), {
            coppiaMax: 10,
            ipFallimentiMax: 50,
            ipTotaleMax: 100,
            finestraMs: 900_000,
        });
    });

    test('valori validi dall\'ambiente', () => {
        assert.deepEqual(
            configurazioneLoginDaAmbiente({
                RATE_LIMIT_LOGIN_COPPIA_MAX: '1000',
                RATE_LIMIT_LOGIN_IP_FALLIMENTI_MAX: '2000',
                RATE_LIMIT_LOGIN_IP_TOTALE_MAX: '10000',
                RATE_LIMIT_LOGIN_FINESTRA_SEC: '60',
            }),
            {
                coppiaMax: 1000,
                ipFallimentiMax: 2000,
                ipTotaleMax: 10000,
                finestraMs: 60_000,
            },
        );
    });

    for (const nome of [
        'RATE_LIMIT_LOGIN_COPPIA_MAX',
        'RATE_LIMIT_LOGIN_IP_FALLIMENTI_MAX',
        'RATE_LIMIT_LOGIN_IP_TOTALE_MAX',
        'RATE_LIMIT_LOGIN_FINESTRA_SEC',
    ]) {
        for (const valore of ['0', '-1', 'abc', '1.5', ' 5']) {
            test(`${nome}="${valore}": errore, non ignorato in silenzio`, () => {
                assert.throws(() =>
                    configurazioneLoginDaAmbiente({ [nome]: valore }),
                );
            });
        }
    }
});
