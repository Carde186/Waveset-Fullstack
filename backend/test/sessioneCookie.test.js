// Trasporto cookie in trovaSessione e middleware CSRF/Origin, con sessioni vere
// nel database di TEST (waveset_test); guardie e canarina di aiuto.js valgono
// anche qui. Le sessioni cookie si creano direttamente nel DB (non esiste ancora
// web/login) e si cancellano per device_id esatto; le playlist create per id.
//
// Due app nel processo del test:
// - A (porta 3092): sessione web CONFIGURATA (FRONTEND_ORIGINS=http://localhost:5173);
// - B (porta 3091): sessione web NON configurata.
// Le richieste usano node:http, per controllare ogni intestazione (Cookie,
// Origin, Authorization, X-CSRF-Token).
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3092/api';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, describe, test } = require('node:test');

const { UTENTE_A, UTENTE_ADMIN, UTENTE_B, db, chiudi, verificaCanarina } = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const { configurazioneWebDaAmbiente } = require('../src/autenticazione/configurazioneWeb');
const { generaCsrf } = require('../src/autenticazione/csrf');
const { generaToken, hashToken } = require('../src/autenticazione/token');

const PORTA_A = 3092;
const PORTA_B = 3091;
const ORIGINE = 'http://localhost:5173';
const MESSAGGIO_403 = 'Richiesta non consentita';

let serverA;
let serverB;
let sessioniPrima;
let playlistPrima;
let utentiPrima;
const deviceUsati = new Set();
const playlistCreate = new Set();

// ----- utilità -------------------------------------------------------------

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
                    risolvi({ stato: risposta.statusCode, intestazioni: risposta.headers, dati });
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

async function idUtente(email) {
    const [[riga]] = await db.query('SELECT id FROM utente WHERE email = ?', [email]);
    return riga.id;
}

// Sessione "browser" inserita direttamente nel DB di test.
async function creaSessioneCookie(utente, { giorni = 7 } = {}) {
    const utenteId = await idUtente(utente.email);
    const deviceId = crypto.randomUUID();
    const token = generaToken();

    await db.query(
        `INSERT INTO sessioni (utente_id, hash_token, device_id, scadenza)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
        [utenteId, hashToken(token), deviceId, giorni],
    );
    deviceUsati.add(deviceId);

    return {
        utenteId,
        deviceId,
        token,
        cookie: `waveset_sid=${deviceId}.${token}`,
        csrf: generaCsrf(token),
    };
}

// Sessione bearer, con il login di sempre (X-Device-Id + token in Authorization).
async function creaSessioneBearer(porta, utente) {
    const deviceId = crypto.randomUUID();

    deviceUsati.add(deviceId);
    const r = await chiama(porta, {
        metodo: 'POST',
        percorso: '/auth/login',
        intestazioni: { 'X-Device-Id': deviceId },
        corpo: { email: utente.email, password: utente.password },
    });

    assert.equal(r.stato, 200);

    return {
        deviceId,
        token: r.dati.token,
        intestazioni: { Authorization: `Bearer ${r.dati.token}`, 'X-Device-Id': deviceId },
    };
}

const completa = s => ({ Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': s.csrf });
const soloCookie = s => ({ Cookie: s.cookie });

async function contaRighe(tabella) {
    const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM ${tabella}`);
    return n;
}

async function creaPlaylist(sessione, nome = 'Playlist di prova') {
    const r = await chiama(PORTA_A, {
        metodo: 'POST',
        percorso: '/playlist',
        intestazioni: completa(sessione),
        corpo: { nome },
    });

    assert.equal(r.stato, 201);
    playlistCreate.add(r.dati.id);
    return r.dati.id;
}

function assert403(r) {
    assert.equal(r.stato, 403);
    assert.deepEqual(r.dati, { messaggio: MESSAGGIO_403 });
}

// ----- preparazione e pulizia ----------------------------------------------

before(async () => {
    serverA = await new Promise((risolvi, rifiuta) => {
        const s = creaApp({
            configurazioneWeb: configurazioneWebDaAmbiente({ FRONTEND_ORIGINS: ORIGINE }),
        }).listen(PORTA_A, errore => (errore ? rifiuta(errore) : risolvi(s)));
    });
    serverB = await new Promise((risolvi, rifiuta) => {
        const s = creaApp({ configurazioneWeb: configurazioneWebDaAmbiente({}) }).listen(
            PORTA_B,
            errore => (errore ? rifiuta(errore) : risolvi(s)),
        );
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
        await new Promise(risolvi => serverA.close(risolvi));
        await new Promise(risolvi => serverB.close(risolvi));
    }
});

// ----- cookie valido: lettura ----------------------------------------------

describe('sessione web configurata: cookie valido in lettura', () => {
    test('GET con cookie valido autentica lo stesso utente e risponde { utente, csrf }, senza Set-Cookie e senza token o hash', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        const io = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: soloCookie(s) });
        assert.equal(io.stato, 200);
        // Con il cookie la risposta è { utente, csrf } (la forma del login web).
        assert.deepEqual(Object.keys(io.dati).sort(), ['csrf', 'utente']);
        assert.deepEqual(Object.keys(io.dati.utente).sort(), ['email', 'id', 'nome', 'ruolo']);
        assert.equal(io.dati.utente.email, UTENTE_A.email);
        assert.equal(io.dati.utente.id, s.utenteId);
        // Il token CSRF c'è ed è quello della sessione.
        assert.match(io.dati.csrf, /^[0-9a-f]{64}$/);
        assert.equal(io.dati.csrf, s.csrf);
        assert.ok(!('set-cookie' in io.intestazioni));

        // Nessun token di sessione, hash o device_id nel corpo.
        const corpo = JSON.stringify(io.dati);
        assert.ok(!corpo.includes(s.token));
        assert.ok(!corpo.includes(hashToken(s.token)));
        assert.ok(!corpo.includes(s.deviceId));
        assert.ok(!('token' in io.dati) && !('hash_token' in io.dati));

        const elenco = await chiama(PORTA_A, { percorso: '/playlist', intestazioni: soloCookie(s) });
        assert.equal(elenco.stato, 200);
        assert.ok(Array.isArray(elenco.dati));
    });

    test('HEAD e GET con altri cookie attorno funzionano', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        const testa = await chiama(PORTA_A, {
            metodo: 'HEAD',
            percorso: '/playlist',
            intestazioni: { Cookie: `tema=scuro; ${s.cookie}; lingua=it` },
        });
        assert.equal(testa.stato, 200);
    });

    test('senza cookie e senza Authorization: 401 come sempre', async () => {
        assert.equal((await chiama(PORTA_A, { percorso: '/auth/io' })).stato, 401);
        assert.equal((await chiama(PORTA_A, { percorso: '/playlist' })).stato, 401);
    });

    test('il ruolo viene dalla sessione: USER = 403 sulle route ADMIN, ADMIN = 200', async () => {
        const utente = await creaSessioneCookie(UTENTE_A);
        const admin = await creaSessioneCookie(UTENTE_ADMIN);

        const negato = await chiama(PORTA_A, { percorso: '/admin/eventi/coda', intestazioni: soloCookie(utente) });
        assert.equal(negato.stato, 403);
        assert.deepEqual(negato.dati, { messaggio: 'Permesso negato' });

        const ammesso = await chiama(PORTA_A, { percorso: '/admin/eventi/coda', intestazioni: soloCookie(admin) });
        assert.equal(ammesso.stato, 200);
    });

    test('isolamento tra utenti: la playlist di A non è visibile né leggibile con la sessione di B', async () => {
        const a = await creaSessioneCookie(UTENTE_A);
        const b = await creaSessioneCookie(UTENTE_B);
        const id = await creaPlaylist(a, 'Solo di A');

        const elencoB = await chiama(PORTA_A, { percorso: '/playlist', intestazioni: soloCookie(b) });
        assert.ok(!elencoB.dati.some(p => p.id === id));

        const dettaglioB = await chiama(PORTA_A, { percorso: `/playlist/${id}`, intestazioni: soloCookie(b) });
        assert.equal(dettaglioB.stato, 404);

        const dettaglioA = await chiama(PORTA_A, { percorso: `/playlist/${id}`, intestazioni: soloCookie(a) });
        assert.equal(dettaglioA.stato, 200);
    });
});

// ----- cookie non valido ---------------------------------------------------

describe('cookie non valido: 401, stessi controlli del bearer', () => {
    test('sessione scaduta: 401 e la riga viene cancellata (come per il bearer)', async () => {
        const s = await creaSessioneCookie(UTENTE_A, { giorni: -1 });

        const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: soloCookie(s) });
        assert.equal(r.stato, 401);

        const [righe] = await db.query('SELECT id FROM sessioni WHERE device_id = ?', [s.deviceId]);
        assert.equal(righe.length, 0);
    });

    test('token sbagliato: 401 e la riga NON viene cancellata (chi non ha il token non può far cancellare la sessione altrui)', async () => {
        const s = await creaSessioneCookie(UTENTE_A, { giorni: -1 });
        const sbagliato = `waveset_sid=${s.deviceId}.${generaToken()}`;

        const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: sbagliato } });
        assert.equal(r.stato, 401);

        const [righe] = await db.query('SELECT id FROM sessioni WHERE device_id = ?', [s.deviceId]);
        assert.equal(righe.length, 1);
    });

    test('device_id sconosciuto: 401', async () => {
        const r = await chiama(PORTA_A, {
            percorso: '/auth/io',
            intestazioni: { Cookie: `waveset_sid=${crypto.randomUUID()}.${generaToken()}` },
        });
        assert.equal(r.stato, 401);
    });

    test('cookie malformato o duplicato in lettura: 401', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        for (const cookie of [
            'waveset_sid=malformato',
            'waveset_sid=',
            `waveset_sid=${s.deviceId}`,
            `waveset_sid=${s.deviceId}.${s.token.toUpperCase()}`,
            `${s.cookie}; ${s.cookie}`,
            `${s.cookie}; waveset_sid=${crypto.randomUUID()}.${generaToken()}`,
            `WAVESET_SID=${s.deviceId}.${s.token}`,
        ]) {
            const r = await chiama(PORTA_A, { percorso: '/auth/io', intestazioni: { Cookie: cookie } });

            assert.equal(r.stato, 401, cookie);
        }
    });

    test('un cookie non valido su una route pubblica in lettura non blocca: resta anonimo (GET è sicuro)', async () => {
        const r = await chiama(PORTA_A, { percorso: '/generi', intestazioni: { Cookie: 'waveset_sid=malformato' } });

        assert.equal(r.stato, 200);
    });
});

// ----- precedenza del bearer -----------------------------------------------

describe('Authorization presente = solo bearer, mai ripiego sul cookie', () => {
    test('bearer valido e cookie di un altro utente valido: vale il bearer', async () => {
        const bearerA = await creaSessioneBearer(PORTA_A, UTENTE_A);
        const cookieB = await creaSessioneCookie(UTENTE_B);

        const r = await chiama(PORTA_A, {
            percorso: '/auth/io',
            intestazioni: { ...bearerA.intestazioni, Cookie: cookieB.cookie },
        });

        assert.equal(r.stato, 200);
        assert.equal(r.dati.email, UTENTE_A.email);
        // Con il bearer la risposta è PIATTA e invariata: i dati dell'utente, senza csrf.
        assert.deepEqual(Object.keys(r.dati).sort(), ['email', 'id', 'nome', 'ruolo']);
        assert.ok(!('csrf' in r.dati));
        assert.ok(!('utente' in r.dati));
    });

    test('bearer NON valido e cookie valido: 401, nessun ripiego sul cookie', async () => {
        const bearerA = await creaSessioneBearer(PORTA_A, UTENTE_A);
        const cookieB = await creaSessioneCookie(UTENTE_B);
        const casi = [
            // token sbagliato, device giusto
            { Authorization: `Bearer ${generaToken()}`, 'X-Device-Id': bearerA.deviceId },
            // token giusto, device sbagliato
            { Authorization: `Bearer ${bearerA.token}`, 'X-Device-Id': crypto.randomUUID() },
            // token giusto, senza X-Device-Id
            { Authorization: `Bearer ${bearerA.token}` },
            // schema diverso
            { Authorization: 'Basic abc', 'X-Device-Id': bearerA.deviceId },
            // Authorization vuota
            { Authorization: '', 'X-Device-Id': bearerA.deviceId },
            // "Bearer" senza token
            { Authorization: 'Bearer', 'X-Device-Id': bearerA.deviceId },
        ];

        for (const intestazioni of casi) {
            const r = await chiama(PORTA_A, {
                percorso: '/playlist',
                intestazioni: { ...intestazioni, Cookie: cookieB.cookie },
            });

            assert.equal(r.stato, 401, JSON.stringify(intestazioni));
        }
    });

    test('bearer valido con cookie presente: la mutazione NON richiede Origin né CSRF e agisce sull\'utente del bearer', async () => {
        const bearerA = await creaSessioneBearer(PORTA_A, UTENTE_A);
        const cookieB = await creaSessioneCookie(UTENTE_B);

        const r = await chiama(PORTA_A, {
            metodo: 'POST',
            percorso: '/playlist',
            intestazioni: { ...bearerA.intestazioni, Cookie: cookieB.cookie },
            corpo: { nome: 'Creata con il bearer' },
        });
        assert.equal(r.stato, 201);
        playlistCreate.add(r.dati.id);

        const [[riga]] = await db.query('SELECT utente_id FROM playlist WHERE id = ?', [r.dati.id]);
        assert.equal(riga.utente_id, await idUtente(UTENTE_A.email));
    });

    test('bearer NON valido e mutazione con cookie valido senza CSRF: 401 (non 403, non cookie), nessuna riga creata', async () => {
        const cookieB = await creaSessioneCookie(UTENTE_B);
        const prima = await contaRighe('playlist');

        const r = await chiama(PORTA_A, {
            metodo: 'POST',
            percorso: '/playlist',
            intestazioni: { Authorization: `Bearer ${generaToken()}`, 'X-Device-Id': crypto.randomUUID(), Cookie: cookieB.cookie },
            corpo: { nome: 'Non deve nascere' },
        });

        assert.equal(r.stato, 401);
        assert.equal(await contaRighe('playlist'), prima);
    });

    test('le sessioni bearer restano di 30 giorni (durata Android invariata)', async () => {
        const bearerA = await creaSessioneBearer(PORTA_A, UTENTE_A);
        const [[{ ore }]] = await db.query(
            'SELECT TIMESTAMPDIFF(HOUR, NOW(), scadenza) AS ore FROM sessioni WHERE device_id = ?',
            [bearerA.deviceId],
        );

        assert.ok(ore >= 719 && ore <= 720, `ore alla scadenza: ${ore}`);
    });
});

// ----- mutazioni con cookie ------------------------------------------------

describe('mutazione con cookie di sessione: Origin ammesso E CSRF valido, altrimenti 403', () => {
    const ORIGINI_ERRATE = [
        'http://evil.example',
        'null',
        '*',
        'http://localhost:5173.evil.example',
        'http://localhost:5173/',
        'http://xlocalhost:5173',
        'http://localhost:51730',
        'http://localhost',
        'https://localhost:5173',
        'HTTP://LOCALHOST:5173',
    ];

    test('POST /playlist: ogni combinazione incompleta o errata è 403, senza effetti', async () => {
        const s = await creaSessioneCookie(UTENTE_A);
        const altra = await creaSessioneCookie(UTENTE_B);
        const prima = await contaRighe('playlist');
        const corpo = { nome: 'Non deve nascere' };
        const flip = `${s.csrf.slice(0, 63)}${s.csrf.endsWith('0') ? '1' : '0'}`;

        const casi = [
            { Cookie: s.cookie },
            { Cookie: s.cookie, Origin: ORIGINE },
            { Cookie: s.cookie, 'X-CSRF-Token': s.csrf },
            ...ORIGINI_ERRATE.map(o => ({ Cookie: s.cookie, Origin: o, 'X-CSRF-Token': s.csrf })),
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': flip },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': s.csrf.slice(0, 63) },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': `${s.csrf}0` },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': s.csrf.toUpperCase() },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': '' },
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': s.token }, // il token di sessione non vale
            { Cookie: s.cookie, Origin: ORIGINE, 'X-CSRF-Token': altra.csrf }, // CSRF di un'altra sessione
        ];

        for (const intestazioni of casi) {
            const r = await chiama(PORTA_A, { metodo: 'POST', percorso: '/playlist', intestazioni, corpo });

            assert403(r);
        }
        assert.equal(await contaRighe('playlist'), prima);
    });

    test('POST /playlist con cookie, Origin ammesso e CSRF valido: 201, playlist dell\'utente della sessione', async () => {
        const s = await creaSessioneCookie(UTENTE_A);
        const id = await creaPlaylist(s, 'Creata con il cookie');

        const [[riga]] = await db.query('SELECT utente_id, nome FROM playlist WHERE id = ?', [id]);
        assert.equal(riga.utente_id, s.utenteId);
        assert.equal(riga.nome, 'Creata con il cookie');
    });

    test('PUT e DELETE: senza CSRF 403 e nessuna modifica; con CSRF funzionano', async () => {
        const s = await creaSessioneCookie(UTENTE_A);
        const id = await creaPlaylist(s, 'Originale');

        const putSenza = await chiama(PORTA_A, {
            metodo: 'PUT', percorso: `/playlist/${id}`, intestazioni: soloCookie(s), corpo: { nome: 'Rubata' },
        });
        assert403(putSenza);
        assert.equal((await db.query('SELECT nome FROM playlist WHERE id = ?', [id]))[0][0].nome, 'Originale');

        const putCon = await chiama(PORTA_A, {
            metodo: 'PUT', percorso: `/playlist/${id}`, intestazioni: completa(s), corpo: { nome: 'Rinominata' },
        });
        assert.equal(putCon.stato, 200);
        assert.equal((await db.query('SELECT nome FROM playlist WHERE id = ?', [id]))[0][0].nome, 'Rinominata');

        const delSenza = await chiama(PORTA_A, { metodo: 'DELETE', percorso: `/playlist/${id}`, intestazioni: soloCookie(s) });
        assert403(delSenza);
        assert.equal((await db.query('SELECT id FROM playlist WHERE id = ?', [id]))[0].length, 1);

        const delCon = await chiama(PORTA_A, { metodo: 'DELETE', percorso: `/playlist/${id}`, intestazioni: completa(s) });
        assert.equal(delCon.stato, 200);
        assert.equal((await db.query('SELECT id FROM playlist WHERE id = ?', [id]))[0].length, 0);
    });

    test('il CSRF di una sessione non vale per un\'altra: A con il CSRF di B è 403 e non modifica la playlist di A', async () => {
        const a = await creaSessioneCookie(UTENTE_A);
        const b = await creaSessioneCookie(UTENTE_B);
        const id = await creaPlaylist(a, 'Di A');

        const r = await chiama(PORTA_A, {
            metodo: 'DELETE',
            percorso: `/playlist/${id}`,
            intestazioni: { Cookie: a.cookie, Origin: ORIGINE, 'X-CSRF-Token': b.csrf },
        });

        assert403(r);
        assert.equal((await db.query('SELECT id FROM playlist WHERE id = ?', [id]))[0].length, 1);
    });

    test('un cookie duplicato o malformato su una mutazione: 403, anche con Origin e CSRF di una sessione valida', async () => {
        const s = await creaSessioneCookie(UTENTE_A);
        const prima = await contaRighe('playlist');

        for (const cookie of [
            `${s.cookie}; ${s.cookie}`,
            `${s.cookie}; waveset_sid=${crypto.randomUUID()}.${generaToken()}`,
            'waveset_sid=malformato',
            'waveset_sid=',
            `waveset_sid=${s.deviceId}`,
        ]) {
            const r = await chiama(PORTA_A, {
                metodo: 'POST',
                percorso: '/playlist',
                intestazioni: { Cookie: cookie, Origin: ORIGINE, 'X-CSRF-Token': s.csrf },
                corpo: { nome: 'Non deve nascere' },
            });

            assert403(r);
        }
        assert.equal(await contaRighe('playlist'), prima);
    });

    test('cookie valido ma sessione scaduta con Origin e CSRF corretti: la mutazione passa il controllo e poi è 401 (non anonima)', async () => {
        const s = await creaSessioneCookie(UTENTE_A, { giorni: -1 });

        const r = await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/playlist', intestazioni: completa(s), corpo: { nome: 'x' },
        });

        assert.equal(r.stato, 401);
    });
});

// ----- route pubbliche, facoltative, inesistenti ---------------------------

describe('403 anche sulle route pubbliche, con autenticazione facoltativa e sugli URL inesistenti: mai "utente anonimo"', () => {
    test('POST /auth/registrazione (pubblica) con cookie senza CSRF: 403 e nessun utente creato', async () => {
        const s = await creaSessioneCookie(UTENTE_A);
        const email = `csrf-${crypto.randomUUID()}@esempio.test`;
        const prima = await contaRighe('utente');

        const r = await chiama(PORTA_A, {
            metodo: 'POST',
            percorso: '/auth/registrazione',
            intestazioni: soloCookie(s),
            corpo: { nome: 'Utente', email, password: 'password-di-prova-12' },
        });

        assert403(r);
        assert.equal(await contaRighe('utente'), prima);
    });

    test('POST /auth/registrazione con Origin e CSRF validi: supera il controllo (corpo vuoto = 400 di sempre)', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        const r = await chiama(PORTA_A, {
            metodo: 'POST', percorso: '/auth/registrazione', intestazioni: completa(s), corpo: {},
        });

        assert.equal(r.stato, 400);
        assert.equal(r.dati.messaggio, 'Dati non validi');
    });

    test('POST /auth/login (bearer, pubblica) con cookie senza CSRF: 403', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        const r = await chiama(PORTA_A, {
            metodo: 'POST',
            percorso: '/auth/login',
            intestazioni: { ...soloCookie(s), 'X-Device-Id': crypto.randomUUID() },
            corpo: { email: UTENTE_A.email, password: UTENTE_A.password },
        });

        assert403(r);
    });

    test('mutazione su una route con autenticazione facoltativa (esiste solo GET): 403 prima di ogni route, non 404', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        assert403(await chiama(PORTA_A, { metodo: 'POST', percorso: '/generi', intestazioni: soloCookie(s), corpo: {} }));
        assert403(await chiama(PORTA_A, { metodo: 'DELETE', percorso: '/generi', intestazioni: soloCookie(s) }));

        // Con Origin e CSRF validi la richiesta arriva alla route (che per POST non esiste).
        const passa = await chiama(PORTA_A, { metodo: 'POST', percorso: '/generi', intestazioni: completa(s), corpo: {} });
        assert.equal(passa.stato, 404);
    });

    test('URL inesistente con cookie: 403 senza CSRF, 404 con CSRF', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        assert403(await chiama(PORTA_A, { metodo: 'POST', percorso: '/non-esiste', intestazioni: soloCookie(s), corpo: {} }));
        assert.equal(
            (await chiama(PORTA_A, { metodo: 'POST', percorso: '/non-esiste', intestazioni: completa(s), corpo: {} })).stato,
            404,
        );
    });

    test('nessuna regressione per chi non usa il cookie: senza cookie, o con cookie non nostri, la mutazione è come prima', async () => {
        for (const intestazioni of [{}, { Cookie: 'tema=scuro; lingua=it' }]) {
            const registrazione = await chiama(PORTA_A, {
                metodo: 'POST', percorso: '/auth/registrazione', intestazioni, corpo: {},
            });
            assert.equal(registrazione.stato, 400);

            const playlist = await chiama(PORTA_A, {
                metodo: 'POST', percorso: '/playlist', intestazioni, corpo: { nome: 'x' },
            });
            assert.equal(playlist.stato, 401);
        }
    });
});

// ----- sessione web NON configurata ----------------------------------------

describe('sessione web NON configurata: il cookie non autentica nessuno e nulla cambia per il bearer', () => {
    test('cookie valido in lettura: 401', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        assert.equal((await chiama(PORTA_B, { percorso: '/auth/io', intestazioni: soloCookie(s) })).stato, 401);
        assert.equal((await chiama(PORTA_B, { percorso: '/playlist', intestazioni: soloCookie(s) })).stato, 401);
    });

    test('mutazione con cookie valido, con o senza Origin e CSRF: 401 (mai 403), nessuna riga creata', async () => {
        const s = await creaSessioneCookie(UTENTE_A);
        const prima = await contaRighe('playlist');

        for (const intestazioni of [soloCookie(s), completa(s)]) {
            const r = await chiama(PORTA_B, {
                metodo: 'POST', percorso: '/playlist', intestazioni, corpo: { nome: 'Non deve nascere' },
            });

            assert.equal(r.stato, 401);
        }
        assert.equal(await contaRighe('playlist'), prima);
    });

    test('route pubbliche con cookie: nessun 403 del middleware (registrazione con corpo vuoto = 400 di sempre)', async () => {
        const s = await creaSessioneCookie(UTENTE_A);

        for (const cookie of [s.cookie, 'waveset_sid=malformato', `${s.cookie}; ${s.cookie}`]) {
            const r = await chiama(PORTA_B, {
                metodo: 'POST', percorso: '/auth/registrazione', intestazioni: { Cookie: cookie }, corpo: {},
            });

            assert.equal(r.stato, 400);
        }
    });

    test('il bearer funziona come prima, anche con un cookie presente', async () => {
        const bearerA = await creaSessioneBearer(PORTA_B, UTENTE_A);
        const cookieB = await creaSessioneCookie(UTENTE_B);

        const io = await chiama(PORTA_B, {
            percorso: '/auth/io', intestazioni: { ...bearerA.intestazioni, Cookie: cookieB.cookie },
        });
        assert.equal(io.stato, 200);
        assert.equal(io.dati.email, UTENTE_A.email);

        const crea = await chiama(PORTA_B, {
            metodo: 'POST',
            percorso: '/playlist',
            intestazioni: { ...bearerA.intestazioni, Cookie: cookieB.cookie },
            corpo: { nome: 'Bearer senza configurazione web' },
        });
        assert.equal(crea.stato, 201);
        playlistCreate.add(crea.dati.id);
    });

    test('anche una configurazione web NON valida disabilita il cookie e lascia il bearer', async () => {
        const salvata = process.env.FRONTEND_ORIGINS;
        process.env.FRONTEND_ORIGINS = '*';

        const avvisi = [];
        const originale = console.warn;
        console.warn = (...argomenti) => avvisi.push(argomenti.join(' '));

        let server;
        try {
            server = await new Promise((risolvi, rifiuta) => {
                const s = creaApp().listen(0, errore => (errore ? rifiuta(errore) : risolvi(s)));
            });
        } finally {
            console.warn = originale;
            if (salvata === undefined) {
                delete process.env.FRONTEND_ORIGINS;
            } else {
                process.env.FRONTEND_ORIGINS = salvata;
            }
        }

        try {
            const porta = server.address().port;
            const s = await creaSessioneCookie(UTENTE_A);
            const bearer = await creaSessioneBearer(porta, UTENTE_A);

            assert.ok(avvisi.some(a => a.includes('Sessione browser DISABILITATA')));
            assert.equal((await chiama(porta, { percorso: '/auth/io', intestazioni: soloCookie(s) })).stato, 401);
            assert.equal((await chiama(porta, { percorso: '/auth/io', intestazioni: bearer.intestazioni })).stato, 200);
        } finally {
            await new Promise(risolvi => server.close(risolvi));
        }
    });
});
