// POST /api/auth/web/login contro il database di TEST (waveset_test): guardie e
// canarina di aiuto.js valgono anche qui. Tre app nel processo del test:
// - A (3090): sessione web configurata, limiti BASSI e orologio controllato,
//   IP simulato con X-Test-Ip (parametro di codice di creaApp, solo nei test);
// - B (3089): sessione web NON configurata (assente o non valida);
// - C (3088): sessione web configurata con COOKIE_SECURE=true.
// Le sessioni create si cancellano per device_id esatto (letto dal Set-Cookie o
// scelto dal test); le playlist per id.
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3090/api';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, describe, mock, test } = require('node:test');

const bcrypt = require('bcrypt');

const {
    UTENTE_A,
    UTENTE_ADMIN,
    UTENTE_B,
    db,
    chiudi,
    verificaCanarina,
} = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const { configurazioneWebDaAmbiente } = require('../src/autenticazione/configurazioneWeb');
const { generaCsrf } = require('../src/autenticazione/csrf');
const { creaLimiteLogin } = require('../src/autenticazione/limiteLogin');
const { MESSAGGIO_429 } = require('../src/autenticazione/limiteRichieste');
const { generaToken, hashToken } = require('../src/autenticazione/token');

const PORTA_A = 3090;
const PORTA_B = 3089;
const PORTA_C = 3088;
const ORIGINE = 'http://localhost:5173';
const MESSAGGIO_403 = 'Richiesta non consentita';
const PASSWORD_SBAGLIATA = 'password-sbagliata-12';
const FINESTRA_MS = 900_000;

let orologioA = 1_000_000;
let limitiA;
let limitiB;
let serverA;
let serverB;
let serverC;
let spiaConfronto;
let sessioniPrima;
let playlistPrima;
let utentiPrima;
let contatoreIp = 0;
const deviceUsati = new Set();
const playlistCreate = new Set();

const ipNuovo = () => `198.51.100.${++contatoreIp}`;

// ----- utilità -------------------------------------------------------------

// Ogni Set-Cookie di waveset_sid ricevuto da QUALUNQUE richiesta del file registra
// il device_id per la pulizia finale (per valore esatto). Non stampa né conserva
// il cookie o il token: solo l'identificativo del dispositivo.
function registraDeviceDaSetCookie(valori) {
    for (const valore of valori ?? []) {
        const trovato = /^waveset_sid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i.exec(valore);

        if (trovato) {
            deviceUsati.add(trovato[1]);
        }
    }
}

function chiama(porta, { metodo = 'GET', percorso, intestazioni = {}, corpo }) {
    return new Promise((risolvi, rifiuta) => {
        const testo =
            corpo === undefined
                ? undefined
                : typeof corpo === 'string'
                  ? corpo
                  : JSON.stringify(corpo);
        const h = { ...intestazioni };

        if (testo !== undefined) {
            h['Content-Type'] = h['Content-Type'] ?? 'application/json';
            h['Content-Length'] = Buffer.byteLength(testo);
        }

        const richiesta = http.request(
            { host: '127.0.0.1', port: porta, method: metodo, path: `/api${percorso}`, headers: h, agent: false },
            risposta => {
                const pezzi = [];

                risposta.on('data', p => pezzi.push(p));
                risposta.on('end', () => {
                    const testoRisposta = Buffer.concat(pezzi).toString();
                    let dati = null;

                    try {
                        dati = testoRisposta ? JSON.parse(testoRisposta) : null;
                    } catch {
                        dati = testoRisposta;
                    }
                    registraDeviceDaSetCookie(risposta.headers['set-cookie']);
                    risolvi({
                        stato: risposta.statusCode,
                        intestazioni: risposta.headers,
                        dati,
                        testo: testoRisposta,
                    });
                });
            },
        );

        richiesta.on('error', rifiuta);
        if (testo !== undefined) {
            richiesta.write(testo);
        }
        richiesta.end();
    });
}

// Login web (Origin ammessa di default).
// `origine` NON presente = Origin ammesso; `origine: undefined` (proprietà presente)
// = nessuna intestazione Origin. Object.hasOwn distingue i due casi, che un
// valore predefinito del parametro confonderebbe.
function loginWeb(porta, opzioni) {
    const { email, password, ip, cookie, extra = {}, corpo } = opzioni;
    const origine = Object.hasOwn(opzioni, 'origine') ? opzioni.origine : ORIGINE;
    const intestazioni = { ...extra };

    if (origine !== undefined) {
        intestazioni.Origin = origine;
    }
    if (cookie !== undefined) {
        intestazioni.Cookie = cookie;
    }
    if (ip) {
        intestazioni['X-Test-Ip'] = ip;
    }

    return chiama(porta, {
        metodo: 'POST',
        percorso: '/auth/web/login',
        intestazioni,
        corpo: corpo ?? { email, password },
    });
}

// Login bearer di sempre.
function loginBearer(porta, { email, password, ip, deviceId = crypto.randomUUID() }) {
    deviceUsati.add(deviceId);

    return chiama(porta, {
        metodo: 'POST',
        percorso: '/auth/login',
        intestazioni: { 'X-Device-Id': deviceId, ...(ip ? { 'X-Test-Ip': ip } : {}) },
        corpo: { email, password },
    });
}

// Estrae dal Set-Cookie: { raw, coppia, deviceId, token, attributi: Map }.
function leggiSetCookie(risposta) {
    const valori = risposta.intestazioni['set-cookie'];

    assert.ok(Array.isArray(valori) && valori.length === 1, 'un solo Set-Cookie');

    const [coppia, ...resto] = valori[0].split('; ');
    const attributi = new Map();

    for (const a of resto) {
        const uguale = a.indexOf('=');

        attributi.set(
            (uguale === -1 ? a : a.slice(0, uguale)).toLowerCase(),
            uguale === -1 ? true : a.slice(uguale + 1),
        );
    }

    const [nome, valore] = [coppia.slice(0, coppia.indexOf('=')), coppia.slice(coppia.indexOf('=') + 1)];
    const [deviceId, token] = valore.split('.');

    deviceUsati.add(deviceId);
    return { raw: valori[0], coppia, nome, deviceId, token, attributi };
}

async function contaRighe(tabella) {
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM ${tabella}`);
    return n;
}

async function righeSessione(deviceId) {
    const [righe] = await db.query(
        'SELECT id, utente_id, hash_token, scadenza FROM sessioni WHERE device_id = ?',
        [deviceId],
    );
    return righe;
}

async function idUtente(email) {
    const [[riga]] = await db.query('SELECT id FROM utente WHERE email = ?', [email]);
    return riga.id;
}

// Sessione "vecchia" inserita direttamente (scadenza in giorni, anche negativa).
async function inserisciSessione(utente, { giorni = 7 } = {}) {
    const deviceId = crypto.randomUUID();
    const token = generaToken();

    await db.query(
        `INSERT INTO sessioni (utente_id, hash_token, device_id, scadenza)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [await idUtente(utente.email), hashToken(token), deviceId, giorni],
    );
    deviceUsati.add(deviceId);

    return { deviceId, token, cookie: `waveset_sid=${deviceId}.${token}`, csrf: generaCsrf(token) };
}

const chiamateConfronto = () => spiaConfronto.mock.calls.length;
const zero = { totaleIp: 0, fallimentiIp: 0, fallimentiCoppia: 0 };

// ----- preparazione e pulizia ----------------------------------------------

before(async () => {
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
        ipFallimentiMax: 5,
        ipTotaleMax: 8,
        finestraMs: FINESTRA_MS,
    });

    const avvia = (porta, opzioni) =>
        new Promise((risolvi, rifiuta) => {
            const s = creaApp(opzioni).listen(porta, errore => (errore ? rifiuta(errore) : risolvi(s)));
        });

    serverA = await avvia(PORTA_A, {
        configurazioneWeb: configurazioneWebDaAmbiente({ FRONTEND_ORIGINS: ORIGINE }),
        limitiLogin: limitiA,
        ricavaIp: req => req.get('X-Test-Ip') ?? req.ip,
    });
    serverB = await avvia(PORTA_B, {
        configurazioneWeb: configurazioneWebDaAmbiente({}),
        limitiLogin: limitiB,
        ricavaIp: req => req.get('X-Test-Ip') ?? req.ip,
    });
    serverC = await avvia(PORTA_C, {
        configurazioneWeb: configurazioneWebDaAmbiente({ FRONTEND_ORIGINS: ORIGINE, COOKIE_SECURE: 'true' }),
    });
    await verificaCanarina();

    sessioniPrima = await contaRighe('sessioni');
    playlistPrima = await contaRighe('playlist');
    utentiPrima = await contaRighe('utente');
});

after(async () => {
    try {
        if (playlistCreate.size > 0) {
            await db.query('DELETE FROM playlist WHERE id IN (?)', [[...playlistCreate]]);
        }
        if (deviceUsati.size > 0) {
            await db.query('DELETE FROM sessioni WHERE device_id IN (?)', [[...deviceUsati]]);
        }

        assert.equal(await contaRighe('sessioni'), sessioniPrima, 'sessioni residue');
        assert.equal(await contaRighe('playlist'), playlistPrima, 'playlist residue');
        assert.equal(await contaRighe('utente'), utentiPrima, 'utenti modificati');
    } finally {
        spiaConfronto.mock.restore();
        await chiudi();
        await poolApp.end();
        for (const s of [serverA, serverB, serverC]) {
            await new Promise(risolvi => s.close(risolvi));
        }
    }
});

// ----- configurazione web non valida ---------------------------------------

describe('web/login solo con configurazione web valida', () => {
    for (const [nome, configurazione] of [
        ['FRONTEND_ORIGINS assente', configurazioneWebDaAmbiente({})],
        ['FRONTEND_ORIGINS non valida', configurazioneWebDaAmbiente({ FRONTEND_ORIGINS: '*' })],
    ]) {
        test(`${nome}: 503 controllato, nessuna sessione, nessun cookie, nessun limite consumato, nessun bcrypt`, async () => {
            const porta = 3087;
            const limiti = creaLimiteLogin({ coppiaMax: 3, ipFallimentiMax: 5, ipTotaleMax: 8, finestraMs: FINESTRA_MS });
            const server = await new Promise((risolvi, rifiuta) => {
                const s = creaApp({ configurazioneWeb: configurazione, limitiLogin: limiti }).listen(porta, e =>
                    e ? rifiuta(e) : risolvi(s),
                );
            });

            try {
                const sessioni = await contaRighe('sessioni');
                const prima = chiamateConfronto();

                for (const origine of [ORIGINE, undefined, 'http://evil.example']) {
                    const r = await loginWeb(porta, { ...UTENTE_A, origine });

                    assert.equal(r.stato, 503);
                    assert.deepEqual(r.dati, { messaggio: 'Sessione browser non disponibile' });
                    assert.ok(!('set-cookie' in r.intestazioni));
                    assert.equal(r.intestazioni['cache-control'], 'no-store');
                }

                assert.equal(await contaRighe('sessioni'), sessioni);
                assert.equal(chiamateConfronto(), prima);
                assert.deepEqual(limiti.conteggi('127.0.0.1', UTENTE_A.email), zero);
            } finally {
                await new Promise(risolvi => server.close(risolvi));
            }
        });
    }

    test('sul server senza configurazione il bearer funziona come sempre e non ha Set-Cookie', async () => {
        const r = await loginBearer(PORTA_B, UTENTE_A);

        assert.equal(r.stato, 200);
        assert.deepEqual(Object.keys(r.dati).sort(), ['token', 'utente']);
        assert.ok(!('set-cookie' in r.intestazioni));
    });
});

// ----- Origin ----------------------------------------------------------------

describe('Origin presente e ammesso, controllato prima di DB, bcrypt e limiti', () => {
    const ORIGINI_ERRATE = [
        undefined,
        '',
        'null',
        '*',
        'http://evil.example',
        'http://localhost:5173.evil.example',
        'http://localhost:5173/',
        'http://xlocalhost:5173',
        'http://localhost:51730',
        'http://localhost',
        'https://localhost:5173',
        'HTTP://LOCALHOST:5173',
    ];

    for (const origine of ORIGINI_ERRATE) {
        test(`Origin ${JSON.stringify(origine) ?? 'assente'}: 403 senza sessione, cookie, bcrypt né limiti`, async () => {
            const ip = ipNuovo();
            const sessioni = await contaRighe('sessioni');
            const prima = chiamateConfronto();

            // Credenziali GIUSTE: il rifiuto viene comunque dall'Origin.
            const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip, origine });

            assert.equal(r.stato, 403);
            assert.deepEqual(r.dati, { messaggio: MESSAGGIO_403 });
            assert.ok(!('set-cookie' in r.intestazioni));
            assert.equal(await contaRighe('sessioni'), sessioni);
            assert.equal(chiamateConfronto(), prima);
            assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email), zero);
        });
    }

    test('l\'Origin viene prima del corpo: corpo non valido con Origin errato è 403, non 400', async () => {
        const r = await loginWeb(PORTA_A, { corpo: {}, ip: ipNuovo(), origine: 'http://evil.example' });

        assert.equal(r.stato, 403);
    });

    test('un\'intestazione Authorization non sostituisce l\'Origin', async () => {
        const r = await loginWeb(PORTA_A, {
            ...UTENTE_A, ip: ipNuovo(), origine: undefined, extra: { Authorization: 'Bearer x' },
        });

        assert.equal(r.stato, 403);
    });
});

// ----- validazione e credenziali --------------------------------------------

describe('validazione e credenziali: stesso comportamento 400/401 del bearer', () => {
    const MALFORMATI = [
        ['corpo vuoto', {}],
        ['senza password', { email: UTENTE_A.email }],
        ['senza email', { password: UTENTE_A.password }],
        ['email e password vuote', { email: '', password: '' }],
        ['email oggetto', { email: { email: 1 }, password: UTENTE_A.password }],
        ['email array', { email: [UTENTE_A.email], password: UTENTE_A.password }],
        ['email numero', { email: 5, password: UTENTE_A.password }],
        ['password oggetto', { email: UTENTE_A.email, password: { a: 1 } }],
        ['password numero', { email: UTENTE_A.email, password: 12345678901234 }],
        ['password null', { email: UTENTE_A.email, password: null }],
    ];

    for (const [nome, corpo] of MALFORMATI) {
        test(`${nome}: 400, senza bcrypt né limiti, senza cookie`, async () => {
            const ip = ipNuovo();
            const prima = chiamateConfronto();
            const r = await loginWeb(PORTA_A, { corpo, ip });

            assert.equal(r.stato, 400);
            assert.deepEqual(r.dati, { messaggio: 'email e password obbligatori' });
            assert.ok(!('set-cookie' in r.intestazioni));
            assert.equal(chiamateConfronto(), prima);
            assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email), zero);
        });
    }

    test('corpo non JSON o JSON malformato: 400 senza cookie', async () => {
        for (const corpo of ['{"email": ', 'testo']) {
            const r = await chiama(PORTA_A, {
                metodo: 'POST',
                percorso: '/auth/web/login',
                intestazioni: { Origin: ORIGINE, 'X-Test-Ip': ipNuovo() },
                corpo,
            });

            assert.equal(r.stato, 400);
            assert.ok(!('set-cookie' in r.intestazioni));
        }
    });

    test('password sbagliata ed email inesistente: 401 identico a quello del bearer, senza cookie né sessione', async () => {
        const ip = ipNuovo();
        const sessioni = await contaRighe('sessioni');
        const bearer = await loginBearer(PORTA_A, { email: UTENTE_A.email, password: PASSWORD_SBAGLIATA, ip });
        assert.equal(bearer.stato, 401);

        const sbagliata = await loginWeb(PORTA_A, { email: UTENTE_A.email, password: PASSWORD_SBAGLIATA, ip: ipNuovo() });
        const inesistente = await loginWeb(PORTA_A, {
            email: `non-esiste-${crypto.randomUUID()}@esempio.test`,
            password: PASSWORD_SBAGLIATA,
            ip: ipNuovo(),
        });

        for (const r of [sbagliata, inesistente]) {
            assert.equal(r.stato, 401);
            assert.deepEqual(r.dati, bearer.dati);
            assert.ok(!('set-cookie' in r.intestazioni));
            assert.equal(r.intestazioni['cache-control'], 'no-store');
        }
        assert.equal(await contaRighe('sessioni'), sessioni);
    });

    test('un X-Device-Id inviato dal client viene ignorato (anche se non è un UUID)', async () => {
        const scelto = crypto.randomUUID();
        deviceUsati.add(scelto);

        for (const valore of [scelto, 'non-un-uuid']) {
            const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), extra: { 'X-Device-Id': valore } });

            assert.equal(r.stato, 200);
            assert.notEqual(leggiSetCookie(r).deviceId, scelto);
        }
        assert.equal((await righeSessione(scelto)).length, 0);
    });
});

// ----- successo -------------------------------------------------------------

describe('login riuscito: sessione web di 7 giorni, cookie HttpOnly, token mai nel JSON', () => {
    test('200 con { utente, csrf }, Cache-Control: no-store e un solo Set-Cookie', async () => {
        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() });

        assert.equal(r.stato, 200);
        assert.deepEqual(Object.keys(r.dati), ['utente', 'csrf']);
        assert.deepEqual(Object.keys(r.dati.utente).sort(), ['email', 'id', 'nome', 'ruolo']);
        assert.equal(r.dati.utente.email, UTENTE_A.email);
        assert.equal(r.dati.utente.ruolo, 'USER');
        assert.match(r.dati.csrf, /^[0-9a-f]{64}$/);
        assert.equal(r.intestazioni['cache-control'], 'no-store');
        leggiSetCookie(r); // esattamente uno
    });

    test('attributi del cookie: HttpOnly, SameSite=Strict, Path=/api, Max-Age 7 giorni, nessun Domain, nessun Secure su http', async () => {
        const c = leggiSetCookie(await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() }));

        assert.equal(c.nome, 'waveset_sid');
        assert.match(c.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.match(c.token, /^[0-9a-f]{64}$/);
        assert.equal(c.attributi.get('httponly'), true);
        assert.equal(c.attributi.get('samesite'), 'Strict');
        assert.equal(c.attributi.get('path'), '/api');
        assert.equal(c.attributi.get('max-age'), '604800');
        assert.ok(!c.attributi.has('domain'));
        assert.ok(!c.attributi.has('secure'));
        assert.ok(!c.attributi.has('expires'));
    });

    test('con COOKIE_SECURE=true il cookie è anche Secure', async () => {
        const r = await loginWeb(PORTA_C, { ...UTENTE_A });
        const c = leggiSetCookie(r);

        assert.equal(r.stato, 200);
        assert.equal(c.attributi.get('secure'), true);
        assert.equal(c.attributi.get('httponly'), true);
        assert.equal(c.attributi.get('samesite'), 'Strict');
        assert.equal(c.attributi.get('path'), '/api');
        assert.ok(!c.attributi.has('domain'));
    });

    test('il corpo non contiene MAI il token di sessione, il suo hash né il device_id', async () => {
        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() });
        const c = leggiSetCookie(r);

        assert.ok(!r.testo.includes(c.token));
        assert.ok(!r.testo.includes(hashToken(c.token)));
        assert.ok(!r.testo.includes(c.deviceId));
        assert.ok(!r.testo.toLowerCase().includes('token":'));
        assert.ok(!('token' in r.dati));
        assert.ok(!('hash_token' in r.dati));
        assert.ok(!('password_hash' in r.dati.utente));
    });

    test('riga in sessioni: device_id del server, hash del token, utente giusto, scadenza a 7 giorni', async () => {
        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() });
        const c = leggiSetCookie(r);

        const [riga, ...altre] = await righeSessione(c.deviceId);
        assert.equal(altre.length, 0);
        assert.equal(riga.hash_token, hashToken(c.token));
        assert.equal(riga.utente_id, await idUtente(UTENTE_A.email));
        assert.equal(r.dati.csrf, generaCsrf(c.token));

        const [[{ ore }]] = await db.query(
            'SELECT TIMESTAMPDIFF(HOUR, NOW(), scadenza) AS ore FROM sessioni WHERE device_id = ?',
            [c.deviceId],
        );
        assert.ok(ore >= 167 && ore <= 168, `ore alla scadenza: ${ore}`);
    });

    test('a ogni login device_id e token sono nuovi', async () => {
        const uno = leggiSetCookie(await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() }));
        const due = leggiSetCookie(await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() }));

        assert.notEqual(uno.deviceId, due.deviceId);
        assert.notEqual(uno.token, due.token);
    });

    test('il cookie e il csrf ricevuti funzionano davvero: /auth/io e una mutazione con Origin e X-CSRF-Token', async () => {
        const r = await loginWeb(PORTA_A, { ...UTENTE_B, ip: ipNuovo() });
        const c = leggiSetCookie(r);

        const io = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: c.coppia } });
        assert.equal(io.stato, 200);
        // Con il cookie: { utente, csrf }, l'email sta in utente.email.
        assert.deepEqual(Object.keys(io.dati).sort(), ['csrf', 'utente']);
        assert.equal(io.dati.utente.email, UTENTE_B.email);
        assert.match(io.dati.csrf, /^[0-9a-f]{64}$/);
        assert.equal(io.dati.csrf, r.dati.csrf);
        // Nessun token di sessione, hash o device_id nella risposta.
        assert.ok(!io.testo.includes(c.token));
        assert.ok(!io.testo.includes(hashToken(c.token)));
        assert.ok(!io.testo.includes(c.deviceId));
        assert.ok(!('token' in io.dati) && !('hash_token' in io.dati));

        const senza = await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/playlist', intestazioni: { Cookie: c.coppia }, corpo: { nome: 'x' },
        });
        assert.equal(senza.stato, 403);

        const crea = await chiama(PORTA_A, {
            metodo: 'POST',
            percorso: '/playlist',
            intestazioni: { Cookie: c.coppia, Origin: ORIGINE, 'X-CSRF-Token': r.dati.csrf },
            corpo: { nome: 'Dopo il web login' },
        });
        assert.equal(crea.stato, 201);
        playlistCreate.add(crea.dati.id);

        // Con il BEARER /auth/io resta PIATTO e invariato: i dati dell'utente, senza csrf.
        const deviceBearer = crypto.randomUUID();
        const bearer = await loginBearer(PORTA_A, { ...UTENTE_B, ip: ipNuovo(), deviceId: deviceBearer });
        const ioBearer = await chiama(PORTA_A, {
            percorso: '/auth/io',
            intestazioni: { Authorization: `Bearer ${bearer.dati.token}`, 'X-Device-Id': deviceBearer },
        });
        assert.equal(ioBearer.stato, 200);
        assert.deepEqual(Object.keys(ioBearer.dati).sort(), ['email', 'id', 'nome', 'ruolo']);
        assert.equal(ioBearer.dati.email, UTENTE_B.email);
        assert.ok(!('csrf' in ioBearer.dati) && !('utente' in ioBearer.dati));
    });

    test('un ADMIN accede con il web login e vale il suo ruolo', async () => {
        const r = await loginWeb(PORTA_A, { ...UTENTE_ADMIN, ip: ipNuovo() });
        const c = leggiSetCookie(r);

        assert.equal(r.dati.utente.ruolo, 'ADMIN');
        assert.equal((await chiama(PORTA_A, { percorso: '/admin/eventi/coda', intestazioni: { Cookie: c.coppia } })).stato, 200);
    });

    test('un login web senza cookie precedente non tocca nessun\'altra sessione dell\'utente', async () => {
        const utenteId = await idUtente(UTENTE_A.email);
        const bearer = await loginBearer(PORTA_A, { ...UTENTE_A, ip: ipNuovo() });
        const [[{ n: prima }]] = await db.query('SELECT COUNT(*) AS n FROM sessioni WHERE utente_id = ?', [utenteId]);

        leggiSetCookie(await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() }));

        const [[{ n: dopo }]] = await db.query('SELECT COUNT(*) AS n FROM sessioni WHERE utente_id = ?', [utenteId]);
        assert.equal(dopo, prima + 1);
        assert.equal(bearer.stato, 200);
    });
});

// ----- regressione bearer ----------------------------------------------------

describe('bearer Android invariato', () => {
    test('/auth/login: stesse chiavi, nessun Set-Cookie, sessione di 30 giorni, device_id del client', async () => {
        const deviceId = crypto.randomUUID();
        const r = await loginBearer(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), deviceId });

        assert.equal(r.stato, 200);
        assert.deepEqual(Object.keys(r.dati).sort(), ['token', 'utente']);
        assert.match(r.dati.token, /^[0-9a-f]{64}$/);
        assert.ok(!('set-cookie' in r.intestazioni));

        const [[{ ore }]] = await db.query(
            'SELECT TIMESTAMPDIFF(HOUR, NOW(), scadenza) AS ore FROM sessioni WHERE device_id = ?',
            [deviceId],
        );
        assert.ok(ore >= 719 && ore <= 720, `ore alla scadenza: ${ore}`);
    });

    test('/auth/login richiede ancora X-Device-Id: 400 senza', async () => {
        const r = await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/auth/login', corpo: { ...UTENTE_A }, intestazioni: { 'X-Test-Ip': ipNuovo() },
        });

        assert.equal(r.stato, 400);
        assert.deepEqual(r.dati, { messaggio: 'email, password e X-Device-Id obbligatori' });
    });

    test('il token bearer non è un cookie web e viceversa: nessun incrocio automatico', async () => {
        const bearer = await loginBearer(PORTA_A, { ...UTENTE_A, ip: ipNuovo() });
        const web = leggiSetCookie(await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() }));

        // Il token web usato come bearer con il suo device_id: è una sessione vera, quindi vale,
        // ma solo perché chi lo presenta ne possiede il token. Un token sbagliato no.
        const conTokenSbagliato = await chiama(PORTA_A, {
            percorso: '/auth/io',
            intestazioni: { Authorization: `Bearer ${generaToken()}`, 'X-Device-Id': web.deviceId, Cookie: web.coppia },
        });
        assert.equal(conTokenSbagliato.stato, 401); // Authorization presente: niente ripiego sul cookie
        assert.equal(bearer.stato, 200);
    });
});

// ----- cookie vecchio ---------------------------------------------------------

describe('cookie vecchio: nessun CSRF su web/login e revoca solo dopo il successo', () => {
    test('con un cookie vecchio VALIDO e senza X-CSRF-Token il login riesce, poi la vecchia sessione è revocata', async () => {
        const vecchia = await inserisciSessione(UTENTE_A);

        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), cookie: vecchia.cookie });
        const nuova = leggiSetCookie(r);

        assert.equal(r.stato, 200);
        assert.notEqual(nuova.deviceId, vecchia.deviceId);
        assert.notEqual(nuova.token, vecchia.token);
        assert.equal((await righeSessione(vecchia.deviceId)).length, 0);
        assert.equal((await righeSessione(nuova.deviceId)).length, 1);

        // La vecchia sessione non vale più.
        const io = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: vecchia.cookie } });
        assert.equal(io.stato, 401);
    });

    test('altre mutazioni con lo stesso cookie vecchio e senza CSRF restano 403 (l\'eccezione è solo web/login)', async () => {
        const vecchia = await inserisciSessione(UTENTE_A);

        for (const [metodo, percorso] of [
            ['POST', '/playlist'],
            ['POST', '/auth/registrazione'],
            ['POST', '/auth/login'],
            ['POST', '/auth/logout'],
            ['POST', '/auth/web/login/'],
            ['POST', '/auth/web/logout'],
            ['PUT', '/auth/web/login'],
        ]) {
            const r = await chiama(PORTA_A, {
                metodo, percorso, intestazioni: { Cookie: vecchia.cookie, Origin: ORIGINE }, corpo: {},
            });

            assert.equal(r.stato, 403, `${metodo} ${percorso}`);
        }
        assert.equal((await righeSessione(vecchia.deviceId)).length, 1);
    });

    test('password sbagliata: 401 e la vecchia sessione NON viene toccata', async () => {
        const vecchia = await inserisciSessione(UTENTE_A);

        const r = await loginWeb(PORTA_A, {
            email: UTENTE_A.email, password: PASSWORD_SBAGLIATA, ip: ipNuovo(), cookie: vecchia.cookie,
        });

        assert.equal(r.stato, 401);
        assert.ok(!('set-cookie' in r.intestazioni));
        assert.equal((await righeSessione(vecchia.deviceId)).length, 1);
    });

    test('Origin errato o richiesta bloccata (429): la vecchia sessione NON viene toccata', async () => {
        const vecchia = await inserisciSessione(UTENTE_A);
        const ip = ipNuovo();

        const origine = await loginWeb(PORTA_A, { ...UTENTE_A, ip, cookie: vecchia.cookie, origine: 'http://evil.example' });
        assert.equal(origine.stato, 403);

        for (let i = 0; i < 3; i++) {
            await loginWeb(PORTA_A, { email: UTENTE_A.email, password: PASSWORD_SBAGLIATA, ip, cookie: vecchia.cookie });
        }
        const bloccato = await loginWeb(PORTA_A, { ...UTENTE_A, ip, cookie: vecchia.cookie });
        assert.equal(bloccato.stato, 429);

        assert.equal((await righeSessione(vecchia.deviceId)).length, 1);
    });

    test('un errore del server durante il login: 500, nessun cookie, e la vecchia sessione resta', async () => {
        const vecchia = await inserisciSessione(UTENTE_A);
        const ip = ipNuovo();

        mock.method(
            poolApp,
            'query',
            async () => {
                throw new Error('guasto simulato del database');
            },
            { times: 1 },
        );
        const originale = console.error;
        console.error = () => {};
        let r;
        try {
            r = await loginWeb(PORTA_A, { ...UTENTE_A, ip, cookie: vecchia.cookie });
        } finally {
            console.error = originale;
        }

        assert.equal(r.stato, 500);
        assert.ok(!('set-cookie' in r.intestazioni));
        assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email), zero); // il guasto non è un tentativo del client
        assert.equal((await righeSessione(vecchia.deviceId)).length, 1);
    });

    test('cookie vecchio SCADUTO: il login riesce e la riga scaduta viene tolta', async () => {
        const scaduta = await inserisciSessione(UTENTE_A, { giorni: -1 });

        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), cookie: scaduta.cookie });

        assert.equal(r.stato, 200);
        assert.equal((await righeSessione(scaduta.deviceId)).length, 0);
        assert.equal((await righeSessione(leggiSetCookie(r).deviceId)).length, 1);
    });

    test('cookie vecchio con il TOKEN SBAGLIATO: il login riesce ma la riga di quel device NON viene cancellata', async () => {
        const vera = await inserisciSessione(UTENTE_B);
        const inventato = `waveset_sid=${vera.deviceId}.${generaToken()}`;

        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), cookie: inventato });

        assert.equal(r.stato, 200);
        assert.equal((await righeSessione(vera.deviceId)).length, 1);
    });

    test('cookie vecchio malformato, duplicato o di un altro nome: il login riesce e non revoca nulla', async () => {
        const vecchia = await inserisciSessione(UTENTE_A);

        for (const cookie of [
            'waveset_sid=malformato',
            'waveset_sid=',
            `${vecchia.cookie}; ${vecchia.cookie}`,
            `WAVESET_SID=${vecchia.deviceId}.${vecchia.token}`,
            'tema=scuro',
        ]) {
            const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), cookie });

            assert.equal(r.stato, 200, cookie);
            leggiSetCookie(r);
        }
        assert.equal((await righeSessione(vecchia.deviceId)).length, 1);
    });

    test('cookie vecchio di un ALTRO utente: chi lo presenta ne possiede il token, quindi si revoca (cambio di account nel browser)', async () => {
        const diB = await inserisciSessione(UTENTE_B);

        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), cookie: diB.cookie });

        assert.equal(r.stato, 200);
        assert.equal((await righeSessione(diB.deviceId)).length, 0);
    });

    test('le sessioni Android (bearer) dello stesso utente NON vengono revocate', async () => {
        const bearer = await loginBearer(PORTA_A, { ...UTENTE_A, ip: ipNuovo() });
        const vecchia = await inserisciSessione(UTENTE_A);
        const bearerId = bearer.dati.token;

        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), cookie: vecchia.cookie });
        assert.equal(r.stato, 200);

        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM sessioni WHERE hash_token = ?',
            [hashToken(bearerId)],
        );
        assert.equal(n, 1);

        // E il bearer continua a funzionare (device_id scelto dal test dentro loginBearer).
        const [[{ device_id: deviceId }]] = await db.query(
            'SELECT device_id FROM sessioni WHERE hash_token = ?',
            [hashToken(bearerId)],
        );
        const io = await chiama(PORTA_A, {
            percorso: '/auth/io',
            intestazioni: { Authorization: `Bearer ${bearerId}`, 'X-Device-Id': deviceId },
        });
        assert.equal(io.stato, 200);
    });

    test('se la revoca della vecchia sessione fallisce, il login riuscito non fallisce', async () => {
        const vecchia = await inserisciSessione(UTENTE_A);
        const originale = poolApp.query.bind(poolApp);
        const consoleOriginale = console.error;
        const registrati = [];

        mock.method(poolApp, 'query', async (sql, ...resto) => {
            if (typeof sql === 'string' && sql.startsWith('DELETE FROM sessioni WHERE device_id = ? AND hash_token')) {
                throw new Error('guasto simulato della revoca');
            }
            return originale(sql, ...resto);
        });
        console.error = (...argomenti) => registrati.push(argomenti.join(' '));

        let r;
        try {
            r = await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo(), cookie: vecchia.cookie });
        } finally {
            console.error = consoleOriginale;
            poolApp.query.mock.restore();
        }

        assert.equal(r.stato, 200);
        leggiSetCookie(r);
        assert.equal((await righeSessione(vecchia.deviceId)).length, 1); // non revocata
        assert.ok(registrati.some(m => m.includes('revoca della sessione precedente non riuscita')));
        assert.ok(!registrati.join(' ').includes(vecchia.token));
    });
});

// ----- limitatore condiviso ---------------------------------------------------

describe('un solo limitatore condiviso fra login bearer e login web (3 fallimenti IP+email, 5 per IP, 8 totali)', () => {
    const sbagliataWeb = ip => loginWeb(PORTA_A, { email: UTENTE_A.email, password: PASSWORD_SBAGLIATA, ip });
    const sbagliataBearer = ip => loginBearer(PORTA_A, { email: UTENTE_A.email, password: PASSWORD_SBAGLIATA, ip });

    test('3 fallimenti web, poi bearer e web: 429 (stessi contatori), senza bcrypt né sessione né cookie', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 3; i++) {
            assert.equal((await sbagliataWeb(ip)).stato, 401);
        }

        const prima = chiamateConfronto();
        const sessioni = await contaRighe('sessioni');
        const bearer = await loginBearer(PORTA_A, { ...UTENTE_A, ip });
        const web = await loginWeb(PORTA_A, { ...UTENTE_A, ip });

        for (const r of [bearer, web]) {
            assert.equal(r.stato, 429);
            assert.equal(r.intestazioni['retry-after'], '900');
            assert.deepEqual(r.dati, { messaggio: MESSAGGIO_429 });
            assert.ok(!('set-cookie' in r.intestazioni));
        }
        assert.equal(chiamateConfronto(), prima);
        assert.equal(await contaRighe('sessioni'), sessioni);
    });

    test('e viceversa: 3 fallimenti bearer bloccano anche il web', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 3; i++) {
            assert.equal((await sbagliataBearer(ip)).stato, 401);
        }
        const web = await loginWeb(PORTA_A, { ...UTENTE_A, ip });

        assert.equal(web.stato, 429);
        assert.deepEqual(web.dati, { messaggio: MESSAGGIO_429 });
    });

    test('nessuna quota raddoppiata: 2 fallimenti bearer + 1 web esauriscono i 3 della coppia', async () => {
        const ip = ipNuovo();

        assert.equal((await sbagliataBearer(ip)).stato, 401);
        assert.equal((await sbagliataBearer(ip)).stato, 401);
        assert.equal((await sbagliataWeb(ip)).stato, 401);

        assert.equal((await sbagliataBearer(ip)).stato, 429);
        assert.equal((await sbagliataWeb(ip)).stato, 429);
        assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email).fallimentiCoppia, 3);
    });

    test('un successo (web o bearer) azzera la coppia per entrambi', async () => {
        const ip = ipNuovo();

        assert.equal((await sbagliataBearer(ip)).stato, 401);
        assert.equal((await sbagliataWeb(ip)).stato, 401);
        leggiSetCookie(await loginWeb(PORTA_A, { ...UTENTE_A, ip })); // successo web
        assert.equal(limitiA.conteggi(ip, UTENTE_A.email).fallimentiCoppia, 0);

        for (let i = 0; i < 3; i++) {
            assert.equal((await (i % 2 ? sbagliataWeb(ip) : sbagliataBearer(ip))).stato, 401);
        }
        assert.equal((await sbagliataWeb(ip)).stato, 429);
    });

    test('5 fallimenti per IP su email diverse, mischiando gli endpoint: il successivo (qualunque endpoint, anche con password giusta) è 429', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 5; i++) {
            const email = `inventata-${i}-${crypto.randomUUID()}@esempio.test`;
            const r = i % 2
                ? await loginWeb(PORTA_A, { email, password: PASSWORD_SBAGLIATA, ip })
                : await loginBearer(PORTA_A, { email, password: PASSWORD_SBAGLIATA, ip });

            assert.equal(r.stato, 401);
        }

        assert.equal((await loginWeb(PORTA_A, { ...UTENTE_A, ip })).stato, 429);
        assert.equal((await loginBearer(PORTA_A, { ...UTENTE_A, ip })).stato, 429);
        assert.equal((await loginWeb(PORTA_A, { ...UTENTE_A, ip: ipNuovo() })).stato, 200); // altro IP
    });

    test('8 tentativi totali per IP, riusciti o no e su entrambi gli endpoint: il nono è 429', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 8; i++) {
            const r = i % 2 ? await loginWeb(PORTA_A, { ...UTENTE_A, ip }) : await loginBearer(PORTA_A, { ...UTENTE_A, ip });

            assert.equal(r.stato, 200);
            if (i % 2) {
                leggiSetCookie(r);
            }
        }
        assert.equal((await loginWeb(PORTA_A, { ...UTENTE_A, ip })).stato, 429);
        assert.equal((await loginBearer(PORTA_A, { ...UTENTE_A, ip })).stato, 429);
    });

    test('nessun blocco permanente: alla scadenza della finestra il web torna a funzionare', async () => {
        const ip = ipNuovo();

        for (let i = 0; i < 3; i++) {
            await sbagliataWeb(ip);
        }
        assert.equal((await loginWeb(PORTA_A, { ...UTENTE_A, ip })).stato, 429);

        orologioA += FINESTRA_MS + 1;
        const r = await loginWeb(PORTA_A, { ...UTENTE_A, ip });

        assert.equal(r.stato, 200);
        leggiSetCookie(r);
    });

    test('un errore del server sul login web rilascia tutte le prenotazioni', async () => {
        const ip = ipNuovo();

        mock.method(
            poolApp,
            'query',
            async () => {
                throw new Error('guasto simulato del database');
            },
            { times: 1 },
        );
        const originale = console.error;
        console.error = () => {};
        let r;
        try {
            r = await loginWeb(PORTA_A, { ...UTENTE_A, ip });
        } finally {
            console.error = originale;
        }

        assert.equal(r.stato, 500);
        assert.deepEqual(limitiA.conteggi(ip, UTENTE_A.email), zero);
    });
});
