// /auth/io, logout e logout-tutti per il browser (sessione via cookie) e
// regressione del bearer, contro il database di TEST (waveset_test): guardie e
// canarina di aiuto.js valgono anche qui. Tre app nel processo del test:
// - A (3086): sessione web configurata;
// - B (3085): sessione web NON configurata;
// - C (3084): sessione web configurata con COOKIE_SECURE=true.
// Le sessioni si creano per lo più direttamente nel DB (poche passano dal login
// web vero, per provare che il CSRF coincide) e si cancellano per device_id
// esatto, letto dal Set-Cookie o scelto dal test; le playlist per id.
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3086/api';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, describe, test } = require('node:test');

const { UTENTE_A, UTENTE_B, UTENTE_ADMIN, db, chiudi, verificaCanarina } = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const { configurazioneWebDaAmbiente } = require('../src/autenticazione/configurazioneWeb');
const { generaCsrf } = require('../src/autenticazione/csrf');
const { creaLimiteLogin } = require('../src/autenticazione/limiteLogin');
const { generaToken, hashToken } = require('../src/autenticazione/token');

const PORTA_A = 3086;
const PORTA_B = 3085;
const PORTA_C = 3084;
const ORIGINE = 'http://localhost:5173';
const MESSAGGIO_403 = 'Richiesta non consentita';

let serverA;
let serverB;
let serverC;
let sessioniPrima;
let playlistPrima;
let utentiPrima;
const deviceUsati = new Set();
const playlistCreate = new Set();

// ----- utilità -------------------------------------------------------------

// Ogni Set-Cookie di waveset_sid ricevuto registra il device_id per la pulizia
// (per valore esatto): nessun cookie o token viene stampato o conservato.
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
        const testo = corpo === undefined ? undefined : JSON.stringify(corpo);
        const h = { ...intestazioni };

        if (testo !== undefined) {
            h['Content-Type'] = 'application/json';
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
                    risolvi({ stato: risposta.statusCode, intestazioni: risposta.headers, dati, testo: testoRisposta });
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

function attributi(setCookie) {
    const [coppia, ...resto] = setCookie.split('; ');
    const mappa = new Map();

    for (const a of resto) {
        const uguale = a.indexOf('=');

        mappa.set((uguale === -1 ? a : a.slice(0, uguale)).toLowerCase(), uguale === -1 ? true : a.slice(uguale + 1));
    }
    return { coppia, attributi: mappa };
}

function unicoSetCookie(risposta) {
    const valori = risposta.intestazioni['set-cookie'];

    assert.ok(Array.isArray(valori) && valori.length === 1, 'un solo Set-Cookie');
    return attributi(valori[0]);
}

async function idUtente(email) {
    const [[riga]] = await db.query('SELECT id FROM utente WHERE email = ?', [email]);
    return riga.id;
}

async function contaRighe(tabella) {
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM ${tabella}`);
    return n;
}

async function righeSessione(deviceId) {
    const [righe] = await db.query('SELECT id FROM sessioni WHERE device_id = ?', [deviceId]);
    return righe;
}

async function sessioniDiUtente(email) {
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM sessioni WHERE utente_id = ?', [await idUtente(email)]);
    return n;
}

// Sessione "browser" inserita direttamente nel DB di test (giorni anche negativi).
async function sessioneCookie(utente, { giorni = 7 } = {}) {
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

// Sessione bearer, con il login di sempre.
async function sessioneBearer(porta, utente) {
    const deviceId = crypto.randomUUID();

    deviceUsati.add(deviceId);
    const r = await chiama(porta, {
        metodo: 'POST',
        percorso: '/auth/login',
        intestazioni: { 'X-Device-Id': deviceId },
        corpo: { email: utente.email, password: utente.password },
    });

    assert.equal(r.stato, 200);
    return { deviceId, token: r.dati.token, intestazioni: { Authorization: `Bearer ${r.dati.token}`, 'X-Device-Id': deviceId } };
}

const completa = s => ({ Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': s.csrf });

function assert403(r) {
    assert.equal(r.stato, 403);
    assert.deepEqual(r.dati, { messaggio: MESSAGGIO_403 });
    assert.ok(!('set-cookie' in r.intestazioni));
}

// ----- preparazione e pulizia ----------------------------------------------

before(async () => {
    const limiti = () =>
        creaLimiteLogin({ coppiaMax: 1000, ipFallimentiMax: 1000, ipTotaleMax: 10000, finestraMs: 900_000 });
    const avvia = (porta, opzioni) =>
        new Promise((risolvi, rifiuta) => {
            const s = creaApp({ limitiLogin: limiti(), ...opzioni }).listen(porta, e => (e ? rifiuta(e) : risolvi(s)));
        });

    serverA = await avvia(PORTA_A, { configurazioneWeb: configurazioneWebDaAmbiente({ FRONTEND_ORIGINS: ORIGINE }) });
    serverB = await avvia(PORTA_B, { configurazioneWeb: configurazioneWebDaAmbiente({}) });
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
        await chiudi();
        await poolApp.end();
        for (const s of [serverA, serverB, serverC]) {
            await new Promise(risolvi => s.close(risolvi));
        }
    }
});

// ----- /auth/io ------------------------------------------------------------

describe('/auth/io con la sessione del browser (cookie)', () => {
    test('cookie valido: { utente, csrf }, Cache-Control: no-store, nessun segreto nel corpo, nessun Set-Cookie', async () => {
        const s = await sessioneCookie(UTENTE_A);
        const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: s.cookie } });

        assert.equal(r.stato, 200);
        assert.deepEqual(Object.keys(r.dati).sort(), ['csrf', 'utente']);
        assert.deepEqual(Object.keys(r.dati.utente).sort(), ['email', 'id', 'nome', 'ruolo']);
        assert.equal(r.dati.utente.email, UTENTE_A.email);
        assert.equal(r.dati.utente.id, await idUtente(UTENTE_A.email));
        assert.equal(r.dati.csrf, s.csrf);
        assert.equal(r.intestazioni['cache-control'], 'no-store');
        assert.ok(!('set-cookie' in r.intestazioni));

        assert.ok(!r.testo.includes(s.token));
        assert.ok(!r.testo.includes(hashToken(s.token)));
        assert.ok(!r.testo.includes(s.deviceId));
        assert.ok(!r.testo.includes('password'));
        assert.ok(!('token' in r.dati) && !('hash_token' in r.dati));
    });

    test('il csrf di /auth/io è quello ricevuto dal login web (stessa sessione)', async () => {
        const login = await chiama(PORTA_A, {
            metodo: 'POST',
            percorso: '/auth/web/login',
            intestazioni: { Origin: ORIGINE },
            corpo: { email: UTENTE_B.email, password: UTENTE_B.password },
        });
        assert.equal(login.stato, 200);
        const cookie = unicoSetCookie(login).coppia;

        const io = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: cookie } });
        assert.equal(io.stato, 200);
        assert.equal(io.dati.csrf, login.dati.csrf);
        assert.equal(io.dati.utente.email, UTENTE_B.email);
    });

    test('il csrf ricevuto da /auth/io permette una mutazione con Origin; senza, 403', async () => {
        const s = await sessioneCookie(UTENTE_A);
        const { dati } = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: s.cookie } });

        const senza = await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/playlist', intestazioni: { Cookie: s.cookie, Origin: ORIGINE }, corpo: { nome: 'x' },
        });
        assert403(senza);

        const con = await chiama(PORTA_A, {
            metodo: 'POST',
            percorso: '/playlist',
            intestazioni: { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': dati.csrf },
            corpo: { nome: 'Dopo /auth/io' },
        });
        assert.equal(con.stato, 201);
        playlistCreate.add(con.dati.id);
    });

    test('ogni sessione ha il proprio csrf', async () => {
        const uno = await sessioneCookie(UTENTE_A);
        const due = await sessioneCookie(UTENTE_A);
        const a = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: uno.cookie } });
        const b = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: due.cookie } });

        assert.notEqual(a.dati.csrf, b.dati.csrf);
    });

    test('nessun cookie né Authorization: 401, senza csrf e senza Set-Cookie', async () => {
        const r = await chiama(PORTA_A, { percorso: '/auth/io' });

        assert.equal(r.stato, 401);
        assert.deepEqual(r.dati, { messaggio: 'Sessione non valida' });
        assert.ok(!('set-cookie' in r.intestazioni));
    });

    test('cookie scaduto: 401 senza csrf, e la riga scaduta viene cancellata (come per il bearer)', async () => {
        const s = await sessioneCookie(UTENTE_A, { giorni: -1 });
        const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: s.cookie } });

        assert.equal(r.stato, 401);
        assert.ok(!r.testo.includes('csrf'));
        assert.equal((await righeSessione(s.deviceId)).length, 0);
    });

    test('cookie con token sbagliato, device sconosciuto, malformato o duplicato: 401 senza csrf', async () => {
        const s = await sessioneCookie(UTENTE_A);

        for (const cookie of [
            `waveset_sid=${s.deviceId}.${generaToken()}`,
            `waveset_sid=${crypto.randomUUID()}.${generaToken()}`,
            'waveset_sid=malformato',
            `${s.cookie}; ${s.cookie}`,
        ]) {
            const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: cookie } });

            assert.equal(r.stato, 401, cookie);
            assert.ok(!r.testo.includes('csrf'));
        }
    });

    test('sessione web NON configurata: il cookie non autentica, 401 senza csrf', async () => {
        const s = await sessioneCookie(UTENTE_A);
        const r = await chiama(PORTA_B, { percorso: '/auth/io', intestazioni: { Cookie: s.cookie } });

        assert.equal(r.stato, 401);
        assert.ok(!r.testo.includes('csrf'));
    });
});

describe('/auth/io con il bearer: risposta invariata', () => {
    test('stessa forma di sempre (dati dell\'utente), nessun csrf, nessun no-store aggiunto, nessun Set-Cookie', async () => {
        const b = await sessioneBearer(PORTA_A, UTENTE_A);
        const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: b.intestazioni });

        assert.equal(r.stato, 200);
        assert.deepEqual(Object.keys(r.dati).sort(), ['email', 'id', 'nome', 'ruolo']);
        assert.ok(!('csrf' in r.dati) && !('utente' in r.dati));
        assert.ok(!r.testo.includes('csrf'));
        assert.ok(!('cache-control' in r.intestazioni));
        assert.ok(!('set-cookie' in r.intestazioni));
    });

    test('bearer valido + cookie valido di un altro utente: vale il bearer, risposta bearer (senza csrf)', async () => {
        const b = await sessioneBearer(PORTA_A, UTENTE_A);
        const c = await sessioneCookie(UTENTE_B);
        const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { ...b.intestazioni, Cookie: c.cookie } });

        assert.equal(r.stato, 200);
        assert.equal(r.dati.email, UTENTE_A.email);
        assert.ok(!r.testo.includes('csrf'));
        assert.ok(!('set-cookie' in r.intestazioni));
    });

    test('bearer NON valido + cookie valido: 401, mai ripiego sul cookie (nessun csrf)', async () => {
        const b = await sessioneBearer(PORTA_A, UTENTE_A);
        const c = await sessioneCookie(UTENTE_B);

        for (const intestazioni of [
            { Authorization: `Bearer ${generaToken()}`, 'X-Device-Id': b.deviceId },
            { Authorization: `Bearer ${b.token}`, 'X-Device-Id': crypto.randomUUID() },
            { Authorization: 'Basic abc' },
            { Authorization: '' },
        ]) {
            const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { ...intestazioni, Cookie: c.cookie } });

            assert.equal(r.stato, 401, JSON.stringify(intestazioni));
            assert.ok(!r.testo.includes('csrf'));
        }
    });
});

// ----- logout ----------------------------------------------------------------

describe('POST /auth/logout con la sessione del browser', () => {
    test('con Origin e CSRF: 204, cookie cancellato, e chiude SOLO questa sessione', async () => {
        const s = await sessioneCookie(UTENTE_A);
        const altraWeb = await sessioneCookie(UTENTE_A);
        const bearer = await sessioneBearer(PORTA_A, UTENTE_A);
        const diB = await sessioneCookie(UTENTE_B);

        const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout', intestazioni: completa(s) });

        assert.equal(r.stato, 204);
        assert.equal(r.testo, '');
        assert.equal(r.intestazioni['cache-control'], 'no-store');
        unicoSetCookie(r);

        assert.equal((await righeSessione(s.deviceId)).length, 0);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: s.cookie } })).stato, 401);

        // Le altre sessioni (web, bearer, di un altro utente) sono intatte e funzionano.
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: altraWeb.cookie } })).stato, 200);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: bearer.intestazioni })).stato, 200);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: diB.cookie } })).stato, 200);
    });

    test('il cookie di cancellazione ha gli stessi attributi di quello creato dal login web (Path, HttpOnly, SameSite, Secure, nessun Domain)', async () => {
        for (const [porta, sicuro] of [[PORTA_A, false], [PORTA_C, true]]) {
            const login = await chiama(porta, {
                metodo: 'POST',
                percorso: '/auth/web/login',
                intestazioni: { Origin: ORIGINE },
                corpo: { email: UTENTE_A.email, password: UTENTE_A.password },
            });
            assert.equal(login.stato, 200);
            const creato = unicoSetCookie(login);

            const logout = await chiama(porta, {
                metodo: 'POST',
                percorso: '/auth/logout',
                intestazioni: { Cookie: creato.coppia, Origin: ORIGINE, 'X-CSRF-Token': login.dati.csrf },
            });
            assert.equal(logout.stato, 204);
            const cancellato = unicoSetCookie(logout);

            assert.equal(cancellato.coppia, 'waveset_sid=');
            for (const nome of ['path', 'httponly', 'samesite', 'secure', 'domain']) {
                assert.equal(cancellato.attributi.get(nome), creato.attributi.get(nome), nome);
            }
            assert.equal(cancellato.attributi.get('path'), '/api');
            assert.equal(cancellato.attributi.get('samesite'), 'Strict');
            assert.equal(cancellato.attributi.get('httponly'), true);
            assert.ok(!cancellato.attributi.has('domain'));
            assert.equal(cancellato.attributi.has('secure'), sicuro);
            assert.equal(cancellato.attributi.get('max-age'), '0');
            assert.equal(cancellato.attributi.get('expires'), 'Thu, 01 Jan 1970 00:00:00 GMT');
        }
    });

    test('Origin o CSRF mancanti o errati: 403, nessun Set-Cookie e la sessione resta intatta (nessun effetto collaterale)', async () => {
        const s = await sessioneCookie(UTENTE_A);
        const altra = await sessioneCookie(UTENTE_B);
        const sessioniA = await sessioniDiUtente(UTENTE_A.email);
        const totale = await contaRighe('sessioni');
        const flip = `${s.csrf.slice(0, 63)}${s.csrf.endsWith('0') ? '1' : '0'}`;

        const casi = [
            { Cookie: s.cookie },
            { Cookie: s.cookie, Origin: ORIGINE },
            { Cookie: s.cookie, 'X-CSRF-Token': s.csrf },
            { Cookie: s.cookie, Origin: 'http://evil.example', 'X-CSRF-Token': s.csrf },
            { Cookie: s.cookie, Origin: 'null', 'X-CSRF-Token': s.csrf },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': flip },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': s.csrf.slice(0, 63) },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': altra.csrf },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': s.token },
        ];

        for (const intestazioni of casi) {
            assert403(await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout', intestazioni }));
        }

        assert.equal((await righeSessione(s.deviceId)).length, 1);
        assert.equal(await sessioniDiUtente(UTENTE_A.email), sessioniA);
        assert.equal(await contaRighe('sessioni'), totale);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: s.cookie } })).stato, 200);
    });

    test('nessuna eccezione per il logout: un cookie vecchio con Origin ma senza CSRF è 403 (l\'unica eccezione è web/login)', async () => {
        const s = await sessioneCookie(UTENTE_A);

        assert403(await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/auth/logout', intestazioni: { Cookie: s.cookie, Origin: ORIGINE },
        }));
        assert403(await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/auth/logout-tutti', intestazioni: { Cookie: s.cookie, Origin: ORIGINE },
        }));
        assert.equal((await righeSessione(s.deviceId)).length, 1);
    });

    test('nessun cookie né Authorization: 401, senza Set-Cookie', async () => {
        const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout' });

        assert.equal(r.stato, 401);
        assert.ok(!('set-cookie' in r.intestazioni));
    });

    test('cookie scaduto (con Origin e CSRF corretti): 401, senza Set-Cookie', async () => {
        const s = await sessioneCookie(UTENTE_A, { giorni: -1 });
        const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout', intestazioni: completa(s) });

        assert.equal(r.stato, 401);
        assert.ok(!('set-cookie' in r.intestazioni));
    });

    test('un secondo logout con lo stesso cookie: 401 (la sessione non esiste più)', async () => {
        const s = await sessioneCookie(UTENTE_A);

        assert.equal((await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout', intestazioni: completa(s) })).stato, 204);
        assert.equal((await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout', intestazioni: completa(s) })).stato, 401);
    });

    test('sessione web NON configurata: il cookie non autentica, 401 (mai 403), nessun Set-Cookie', async () => {
        const s = await sessioneCookie(UTENTE_A);
        const r = await chiama(PORTA_B, { metodo: 'POST', percorso: '/auth/logout', intestazioni: completa(s) });

        assert.equal(r.stato, 401);
        assert.ok(!('set-cookie' in r.intestazioni));
        assert.equal((await righeSessione(s.deviceId)).length, 1);
    });
});

describe('POST /auth/logout con il bearer (Android): contratto invariato', () => {
    test('204 senza corpo, nessun Set-Cookie, chiude solo la sessione del dispositivo, senza Origin né CSRF', async () => {
        const telefono = await sessioneBearer(PORTA_A, UTENTE_A);
        const tablet = await sessioneBearer(PORTA_A, UTENTE_A);
        const web = await sessioneCookie(UTENTE_A);

        const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout', intestazioni: telefono.intestazioni });

        assert.equal(r.stato, 204);
        assert.equal(r.testo, '');
        assert.ok(!('set-cookie' in r.intestazioni));
        assert.ok(!('cache-control' in r.intestazioni));
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: telefono.intestazioni })).stato, 401);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: tablet.intestazioni })).stato, 200);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: web.cookie } })).stato, 200);
    });

    test('bearer valido + cookie valido presente: chiude il bearer, NON tocca né cancella il cookie', async () => {
        const bearer = await sessioneBearer(PORTA_A, UTENTE_A);
        const web = await sessioneCookie(UTENTE_A);

        const r = await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/auth/logout', intestazioni: { ...bearer.intestazioni, Cookie: web.cookie },
        });

        assert.equal(r.stato, 204);
        assert.ok(!('set-cookie' in r.intestazioni));
        assert.equal((await righeSessione(bearer.deviceId)).length, 0);
        assert.equal((await righeSessione(web.deviceId)).length, 1);
    });

    test('bearer NON valido + cookie valido con Origin e CSRF giusti: 401, nessun ripiego sul cookie, sessione web intatta', async () => {
        const web = await sessioneCookie(UTENTE_A);

        for (const percorso of ['/auth/logout', '/auth/logout-tutti']) {
            const r = await chiama(PORTA_A, {
                metodo: 'POST',
                percorso,
                intestazioni: { ...completa(web), Authorization: `Bearer ${generaToken()}`, 'X-Device-Id': crypto.randomUUID() },
            });

            assert.equal(r.stato, 401, percorso);
            assert.ok(!('set-cookie' in r.intestazioni));
        }
        assert.equal((await righeSessione(web.deviceId)).length, 1);
    });
});

// ----- logout-tutti -------------------------------------------------------------

describe('POST /auth/logout-tutti', () => {
    test('dal browser (Origin e CSRF): chiude tutte le sessioni dell\'utente (web e Android), cancella il cookie e non tocca gli altri utenti', async () => {
        const s = await sessioneCookie(UTENTE_A);
        const altraWeb = await sessioneCookie(UTENTE_A);
        const bearer = await sessioneBearer(PORTA_A, UTENTE_A);
        const diB = await sessioneCookie(UTENTE_B);

        const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout-tutti', intestazioni: completa(s) });

        assert.equal(r.stato, 204);
        assert.equal(r.testo, '');
        assert.equal(r.intestazioni['cache-control'], 'no-store');
        const cancellato = unicoSetCookie(r);
        assert.equal(cancellato.coppia, 'waveset_sid=');
        assert.equal(cancellato.attributi.get('path'), '/api');
        assert.equal(cancellato.attributi.get('max-age'), '0');

        assert.equal(await sessioniDiUtente(UTENTE_A.email), 0);
        for (const ex of [s, altraWeb]) {
            assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: ex.cookie } })).stato, 401);
        }
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: bearer.intestazioni })).stato, 401);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: diB.cookie } })).stato, 200);
    });

    test('dal bearer (Android): chiude tutte le sessioni dell\'utente, comprese quelle del browser, senza Set-Cookie', async () => {
        const bearer = await sessioneBearer(PORTA_A, UTENTE_ADMIN);
        const web = await sessioneCookie(UTENTE_ADMIN);

        const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout-tutti', intestazioni: bearer.intestazioni });

        assert.equal(r.stato, 204);
        assert.ok(!('set-cookie' in r.intestazioni));
        assert.equal(await sessioniDiUtente(UTENTE_ADMIN.email), 0);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: web.cookie } })).stato, 401);
    });

    test('Origin o CSRF mancanti o errati: 403, nessun Set-Cookie, nessuna sessione chiusa', async () => {
        const s = await sessioneCookie(UTENTE_A);
        await sessioneCookie(UTENTE_A);
        const bearer = await sessioneBearer(PORTA_A, UTENTE_A);
        const sessioniA = await sessioniDiUtente(UTENTE_A.email);
        const totale = await contaRighe('sessioni');

        for (const intestazioni of [
            { Cookie: s.cookie },
            { Cookie: s.cookie, Origin: ORIGINE },
            { Cookie: s.cookie, 'X-CSRF-Token': s.csrf },
            { Cookie: s.cookie, Origin: 'http://evil.example', 'X-CSRF-Token': s.csrf },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': `${s.csrf}0` },
        ]) {
            assert403(await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout-tutti', intestazioni }));
        }

        assert.equal(await sessioniDiUtente(UTENTE_A.email), sessioniA);
        assert.equal(await contaRighe('sessioni'), totale);
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: bearer.intestazioni })).stato, 200);
    });

    test('nessun cookie o cookie scaduto: 401, senza Set-Cookie e senza chiudere nulla', async () => {
        const scaduta = await sessioneCookie(UTENTE_A, { giorni: -1 });
        const sessioniB = await sessioniDiUtente(UTENTE_B.email);

        for (const intestazioni of [{}, completa(scaduta)]) {
            const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/auth/logout-tutti', intestazioni });

            assert.equal(r.stato, 401);
            assert.ok(!('set-cookie' in r.intestazioni));
        }
        assert.equal(await sessioniDiUtente(UTENTE_B.email), sessioniB);
    });

    test('con COOKIE_SECURE=true il cookie di cancellazione è anche Secure', async () => {
        const login = await chiama(PORTA_C, {
            metodo: 'POST',
            percorso: '/auth/web/login',
            intestazioni: { Origin: ORIGINE },
            corpo: { email: UTENTE_B.email, password: UTENTE_B.password },
        });
        assert.equal(login.stato, 200);
        const creato = unicoSetCookie(login);

        const r = await chiama(PORTA_C, {
            metodo: 'POST',
            percorso: '/auth/logout-tutti',
            intestazioni: { Cookie: creato.coppia, Origin: ORIGINE, 'X-CSRF-Token': login.dati.csrf },
        });

        assert.equal(r.stato, 204);
        assert.equal(unicoSetCookie(r).attributi.get('secure'), true);
    });
});
