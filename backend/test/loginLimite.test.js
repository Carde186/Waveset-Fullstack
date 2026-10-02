// Limiti su POST /api/auth/login contro il database di TEST (waveset_test), con
// utenti veri e bcrypt vero. Due app eseguite nel processo del test, con soglie
// basse e orologio controllato (guardie e canarina di aiuto.js valgono anche qui):
//
// - App A (porta 3094): l'IP di ogni richiesta è simulato con l'intestazione
//   X-Test-Ip. Lo fa SOLO questa app, tramite l'opzione `ricavaIp` di creaApp,
//   che è un parametro di codice: l'app di produzione non legge mai l'IP da
//   un'intestazione.
// - App B (porta 3093): senza opzioni di test, IP = indirizzo del socket. Prova
//   che le intestazioni non aggirano il limite e la capacità piena.
//
// Soglie di prova (A): 3 fallimenti per IP+email, 5 fallimenti per IP, 8
// tentativi totali per IP, finestra 900 s.
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3094/api';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, describe, mock, test } = require('node:test');

const bcrypt = require('bcrypt');

const {
    URL_API,
    UTENTE_A,
    UTENTE_B,
    db,
    chiudi,
    nuovoDevice,
    verificaCanarina,
} = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const { creaLimiteLogin } = require('../src/autenticazione/limiteLogin');
const { MESSAGGIO_429 } = require('../src/autenticazione/limiteRichieste');

const FINESTRA_MS = 900_000;
const BASE_A = URL_API;
const BASE_B = 'http://127.0.0.1:3093/api';
const MESSAGGIO_400 = 'email, password e X-Device-Id obbligatori';
const PASSWORD_SBAGLIATA = 'password-sbagliata-12';

let orologioA = 1_000_000;
let orologioB = 1_000_000;
let limitiA;
let limitiB;
let serverA;
let serverB;
let spiaConfronto;
let sessioniPrima;
let contatoreIp = 0;
// Device usati da questo file: la pulizia li cancella per valore esatto e poi
// verifica che non resti nulla, PRIMA di chiudere i pool.
const deviceUsati = new Set();

// Un IP simulato nuovo per ogni test: i limiti sono per IP e i test non si
// influenzano.
const ipNuovo = () => `198.51.100.${++contatoreIp}`;

async function accedi(base, { email, password, ip, deviceId = nuovoDevice(), extra = {}, corpo }) {
    const intestazioni = { 'Content-Type': 'application/json', ...extra };

    if (deviceId !== null) {
        deviceUsati.add(deviceId);
        intestazioni['X-Device-Id'] = deviceId;
    }
    if (ip) {
        intestazioni['X-Test-Ip'] = ip;
    }

    const risposta = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: intestazioni,
        body: JSON.stringify(corpo ?? { email, password }),
    });
    const testo = await risposta.text();

    return {
        stato: risposta.status,
        retryAfter: risposta.headers.get('retry-after'),
        dati: testo ? JSON.parse(testo) : null,
        deviceId,
    };
}

const giusta = ip => ({ ...UTENTE_A, ip });
const sbagliata = ip => ({ email: UTENTE_A.email, password: PASSWORD_SBAGLIATA, ip });

async function contaSessioni(deviceId) {
    const [[{ n }]] = await db.query(
        'SELECT COUNT(*) AS n FROM sessioni WHERE device_id = ?',
        [deviceId],
    );
    return n;
}

const chiamateConfronto = () => spiaConfronto.mock.calls.length;

before(async () => {
    // Registra le chiamate a bcrypt.compare lasciando l'implementazione originale.
    spiaConfronto = mock.method(bcrypt, 'compare');

    limitiA = creaLimiteLogin({
        coppiaMax: 3,
        ipFallimentiMax: 5,
        ipTotaleMax: 8,
        finestraMs: FINESTRA_MS,
        ora: () => orologioA,
    });
    limitiB = creaLimiteLogin({
        coppiaMax: 3,
        ipFallimentiMax: 50,
        ipTotaleMax: 100,
        maxChiavi: 3,
        finestraMs: FINESTRA_MS,
        ora: () => orologioB,
    });

    await new Promise((risolvi, rifiuta) => {
        serverA = creaApp({
            limitiLogin: limitiA,
            ricavaIp: req => req.get('X-Test-Ip') ?? req.ip,
        }).listen(3094, errore => (errore ? rifiuta(errore) : risolvi()));
    });
    await new Promise((risolvi, rifiuta) => {
        serverB = creaApp({ limitiLogin: limitiB }).listen(3093, errore =>
            errore ? rifiuta(errore) : risolvi(),
        );
    });
    await verificaCanarina();

    [[{ n: sessioniPrima }]] = await db.query('SELECT COUNT(*) AS n FROM sessioni');
});

after(async () => {
    try {
        // Prima si cancellano e si contano le sessioni, poi si chiudono i
        // pool: chiudi() chiude quello di aiuto.js, dopo non si può più
        // interrogare il database.
        if (deviceUsati.size > 0) {
            await db.query('DELETE FROM sessioni WHERE device_id IN (?)', [
                [...deviceUsati],
            ]);
        }

        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM sessioni');
        assert.equal(n, sessioniPrima, 'sessioni residue dopo la pulizia');
    } finally {
        // La chiusura avviene anche se l'asserzione qui sopra fallisce.
        spiaConfronto.mock.restore();
        await chiudi();
        await poolApp.end();
        await new Promise(risolvi => serverA.close(risolvi));
        await new Promise(risolvi => serverB.close(risolvi));
    }
});

describe('contratto invariato: 200, 400 e 401 come prima', () => {
    test('200: stesse chiavi di prima, token di 256 bit', async () => {
        const r = await accedi(BASE_A, giusta(ipNuovo()));

        assert.equal(r.stato, 200);
        assert.deepEqual(Object.keys(r.dati).sort(), ['token', 'utente']);
        assert.deepEqual(Object.keys(r.dati.utente).sort(), ['email', 'id', 'nome', 'ruolo']);
        assert.match(r.dati.token, /^[0-9a-f]{64}$/);
        assert.equal(r.dati.utente.email, UTENTE_A.email);
        assert.equal(r.retryAfter, null);
    });

    test('401: password sbagliata, stesso corpo', async () => {
        const r = await accedi(BASE_A, sbagliata(ipNuovo()));

        assert.equal(r.stato, 401);
        assert.deepEqual(r.dati, { messaggio: 'Email o password errati' });
    });

    test('400: campi mancanti o X-Device-Id assente o non UUID, stesso corpo', async () => {
        const ip = ipNuovo();
        const casi = [
            accedi(BASE_A, { email: UTENTE_A.email, ip }),
            accedi(BASE_A, { password: UTENTE_A.password, ip }),
            accedi(BASE_A, { ...giusta(ip), deviceId: null }),
            accedi(BASE_A, { ...giusta(ip), deviceId: 'non-un-uuid' }),
            accedi(BASE_A, { corpo: {}, ip }),
            accedi(BASE_A, { email: '', password: '', ip }),
        ];

        for (const r of await Promise.all(casi)) {
            assert.equal(r.stato, 400);
            assert.deepEqual(r.dati, { messaggio: MESSAGGIO_400 });
        }
    });
});

describe('email e password devono essere stringhe: 400, prima della query e dei limiti', () => {
    const MALFORMATI = [
        ['email oggetto', { email: { email: 1 }, password: UTENTE_A.password }],
        ['email array', { email: [UTENTE_A.email], password: UTENTE_A.password }],
        ['email numero', { email: 5, password: UTENTE_A.password }],
        ['email booleano', { email: true, password: UTENTE_A.password }],
        ['password oggetto', { email: UTENTE_A.email, password: { a: 1 } }],
        ['password numero', { email: UTENTE_A.email, password: 12345678901234 }],
        ['password array', { email: UTENTE_A.email, password: ['x'] }],
        ['password null', { email: UTENTE_A.email, password: null }],
    ];

    for (const [nome, corpo] of MALFORMATI) {
        test(`${nome}: 400 con il messaggio di sempre, non 401 né 500`, async () => {
            const ip = ipNuovo();
            const prima = chiamateConfronto();
            const r = await accedi(BASE_A, { corpo, ip });

            assert.equal(r.stato, 400);
            assert.deepEqual(r.dati, { messaggio: MESSAGGIO_400 });
            assert.equal(chiamateConfronto(), prima); // nessun bcrypt
            assert.equal(await contaSessioni(r.deviceId), 0);
            // Non ha consumato nessun limite.
            assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email), {
                totaleIp: 0,
                fallimentiIp: 0,
                fallimentiCoppia: 0,
            });
        });
    }
});

describe('fallimenti per IP+email (3): 429 prima di bcrypt', () => {
    let corpo401Esistente;
    let corpo429Esistente;

    test('3 fallimenti (401), il quarto è 429 con Retry-After e senza bcrypt', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 3; i++) {
            const r = await accedi(BASE_A, sbagliata(ip));
            assert.equal(r.stato, 401);
            corpo401Esistente = r.dati;
        }
        assert.equal(chiamateConfronto() >= 3, true);

        const prima = chiamateConfronto();
        const bloccato = await accedi(BASE_A, sbagliata(ip));

        assert.equal(bloccato.stato, 429);
        assert.equal(bloccato.retryAfter, '900');
        assert.deepEqual(bloccato.dati, { messaggio: MESSAGGIO_429 });
        assert.equal(chiamateConfronto(), prima);
        corpo429Esistente = bloccato.dati;

        // Richieste bloccate ripetute: stessa risposta, finestra non allungata.
        const ancora = await accedi(BASE_A, sbagliata(ip));
        assert.equal(ancora.stato, 429);
        assert.equal(ancora.retryAfter, '900');
        assert.equal(chiamateConfronto(), prima);
    });

    test('anche la password GIUSTA della coppia bloccata riceve 429, senza sessione né bcrypt', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 3; i++) {
            await accedi(BASE_A, sbagliata(ip));
        }

        const prima = chiamateConfronto();
        const r = await accedi(BASE_A, giusta(ip));

        assert.equal(r.stato, 429);
        assert.equal(await contaSessioni(r.deviceId), 0);
        assert.equal(chiamateConfronto(), prima);
    });

    test('email INESISTENTE: stessa soglia e risposte identiche a quelle di un\'email esistente', async () => {
        const ip = ipNuovo();
        const email = `non-esiste-${crypto.randomUUID()}@esempio.test`;

        for (let i = 0; i < 3; i++) {
            const r = await accedi(BASE_A, { email, password: PASSWORD_SBAGLIATA, ip });

            assert.equal(r.stato, 401);
            assert.deepEqual(r.dati, corpo401Esistente);
        }

        const bloccato = await accedi(BASE_A, { email, password: PASSWORD_SBAGLIATA, ip });
        assert.equal(bloccato.stato, 429);
        assert.equal(bloccato.retryAfter, '900');
        assert.deepEqual(bloccato.dati, corpo429Esistente);
    });

    test('un\'altra email dello stesso IP e la stessa email da un altro IP non sono bloccate', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 4; i++) {
            await accedi(BASE_A, sbagliata(ip));
        }
        assert.equal((await accedi(BASE_A, sbagliata(ip))).stato, 429);

        const altraEmail = await accedi(BASE_A, { ...UTENTE_B, ip });
        assert.equal(altraEmail.stato, 200);

        const altroIp = await accedi(BASE_A, giusta(ipNuovo()));
        assert.equal(altroIp.stato, 200);
    });

    test('un login riuscito azzera la coppia (e non basta ripetere lo stesso numero di errori)', async () => {
        const ip = ipNuovo();

        assert.equal((await accedi(BASE_A, sbagliata(ip))).stato, 401);
        assert.equal((await accedi(BASE_A, giusta(ip))).stato, 200);

        // Senza l'azzeramento il terzo errore qui sotto sarebbe già bloccato.
        for (let i = 0; i < 3; i++) {
            assert.equal((await accedi(BASE_A, sbagliata(ip))).stato, 401);
        }
        assert.equal((await accedi(BASE_A, sbagliata(ip))).stato, 429);
    });
});

describe('fallimenti per IP (5)', () => {
    test('dopo 5 fallimenti su email diverse, QUALUNQUE tentativo dello stesso IP è 429; gli altri IP no', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 5; i++) {
            const r = await accedi(BASE_A, {
                email: `inventata-${i}-${crypto.randomUUID()}@esempio.test`,
                password: PASSWORD_SBAGLIATA,
                ip,
            });
            assert.equal(r.stato, 401);
        }

        const prima = chiamateConfronto();
        const conPasswordGiusta = await accedi(BASE_A, giusta(ip));
        assert.equal(conPasswordGiusta.stato, 429);
        assert.equal(conPasswordGiusta.retryAfter, '900');
        assert.equal(chiamateConfronto(), prima);

        assert.equal((await accedi(BASE_A, giusta(ipNuovo()))).stato, 200);
    });
});

describe('tentativi totali per IP (8)', () => {
    test('anche i login RIUSCITI contano: il nono è 429, senza alcun fallimento registrato', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 8; i++) {
            assert.equal((await accedi(BASE_A, giusta(ip))).stato, 200);
        }
        assert.equal(limitiA.conteggi(ip, UTENTE_A.email).fallimentiIp, 0);

        const prima = chiamateConfronto();
        const r = await accedi(BASE_A, giusta(ip));
        assert.equal(r.stato, 429);
        assert.equal(await contaSessioni(r.deviceId), 0);
        assert.equal(chiamateConfronto(), prima);

        assert.equal((await accedi(BASE_A, giusta(ipNuovo()))).stato, 200);
    });

    test('un login riuscito RESTA nel conteggio totale, un errore del server invece no', async () => {
        const ip = ipNuovo();
        const zero = { totaleIp: 0, fallimentiIp: 0, fallimentiCoppia: 0 };

        // Guasto simulato del database sulla prima query del login (una sola
        // volta: poi il mock si ripristina da solo).
        mock.method(
            poolApp,
            'query',
            async () => {
                throw new Error('guasto simulato del database');
            },
            { times: 1 },
        );

        const prima = chiamateConfronto();
        const guasto = await accedi(BASE_A, giusta(ip));

        assert.equal(guasto.stato, 500);
        assert.deepEqual(guasto.dati, { messaggio: 'Errore interno del server' });
        assert.equal(chiamateConfronto(), prima);
        // Non è un tentativo del client: tutte le prenotazioni sono rilasciate.
        assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email), zero);

        // Un login riuscito, invece, resta un tentativo contabilizzato nel
        // totale (ma non è un fallimento).
        assert.equal((await accedi(BASE_A, giusta(ip))).stato, 200);
        assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email), {
            totaleIp: 1,
            fallimentiIp: 0,
            fallimentiCoppia: 0,
        });
    });
});

describe('nessun blocco permanente', () => {
    test('Retry-After scende e alla scadenza della finestra si può accedere di nuovo', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 3; i++) {
            await accedi(BASE_A, sbagliata(ip));
        }
        assert.equal((await accedi(BASE_A, giusta(ip))).stato, 429);

        orologioA += 899_000;
        const quasi = await accedi(BASE_A, giusta(ip));
        assert.equal(quasi.stato, 429);
        assert.equal(quasi.retryAfter, '1');

        orologioA += 1_000;
        const dopo = await accedi(BASE_A, giusta(ip));
        assert.equal(dopo.stato, 200);
        assert.equal(limitiA.conteggi(ip, UTENTE_A.email).fallimentiCoppia, 0);
    });
});

describe('app senza opzioni di test (IP = indirizzo del socket)', () => {
    test('X-Test-Ip e X-Forwarded-For non aggirano il limite', async () => {
        const email = `spoof-${crypto.randomUUID()}@esempio.test`;
        const finti = ['203.0.113.1', '203.0.113.2', '203.0.113.3', '203.0.113.4'];

        for (const [i, finto] of finti.entries()) {
            const r = await accedi(BASE_B, {
                email,
                password: PASSWORD_SBAGLIATA,
                ip: finto,
                extra: { 'X-Forwarded-For': `198.18.0.${i}` },
            });

            assert.equal(r.stato, i < 3 ? 401 : 429);
        }
    });

    test('capacità piena: una coppia NUOVA è rifiutata (429), nulla resta contato, e dopo la scadenza torna possibile', async () => {
        // La coppia del test precedente occupa 1 voce su 3; altre 2 la riempiono.
        for (let i = 0; i < 2; i++) {
            const r = await accedi(BASE_B, {
                email: `capacita-${i}-${crypto.randomUUID()}@esempio.test`,
                password: PASSWORD_SBAGLIATA,
            });
            assert.equal(r.stato, 401);
        }

        const nuova = `capacita-nuova-${crypto.randomUUID()}@esempio.test`;
        const totaleIpPrima = limitiB.conteggi('127.0.0.1', nuova).totaleIp;
        const prima = chiamateConfronto();

        const bloccata = await accedi(BASE_B, { email: nuova, password: PASSWORD_SBAGLIATA });
        assert.equal(bloccata.stato, 429);
        assert.equal(bloccata.retryAfter, '900');
        assert.deepEqual(bloccata.dati, { messaggio: MESSAGGIO_429 });
        assert.equal(chiamateConfronto(), prima);
        assert.equal(limitiB.conteggi('127.0.0.1', nuova).totaleIp, totaleIpPrima);
        assert.equal(limitiB.dimensioni().fallimentiCoppia, 3);

        orologioB += FINESTRA_MS;
        const dopo = await accedi(BASE_B, { email: nuova, password: PASSWORD_SBAGLIATA });
        assert.equal(dopo.stato, 401);
    });
});
