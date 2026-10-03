// HTTP/Express e bcrypt reali, persistenza esclusivamente in memoria.
// Nessun caricamento del pool MySQL, file .env, DB o fixture persistente.
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const bcrypt = require('bcrypt');
const { hashToken } = require('../src/autenticazione/token');
const { generaCsrf } = require('../src/autenticazione/csrf');
const { validaCambio } = require('../src/autenticazione/account');

const device = '12345678-1234-4234-8234-123456789abc';
const token = 'a'.repeat(64); // Fixture sintetica, mai un token persistente.
const cookie = `waveset_sid=${device}.${token}`;
const password = 'Password-iniziale-12';
let utenti, sessioni, query, server, origine, hash, guasto, concorrente;
const db = { async query(sql, valori) {
    query.push({ sql, valori });
    if (sql.includes('FROM sessioni')) {
        const s = sessioni.find(s => s.device_id === valori[0]);
        return [[...(s ? [{ ...s, valida: 1, ruolo: utenti.find(u => u.id === s.utente_id).ruolo }] : [])]];
    }
    if (sql.includes('FROM utente')) {
        if (guasto && sql.includes('WHERE id')) throw Object.assign(new Error('SQL con dati riservati'), { code: 'ER_INTERNAL' });
        const u = utenti.find(u => sql.includes('WHERE email') ? u.email === valori[0] : u.id === valori[0]);
        if (!u) return [[]];
        return [[sql.includes('password_hash') ? { ...u } : { id: u.id, nome: u.nome, email: u.email, ruolo: u.ruolo }]];
    }
    if (sql.startsWith('UPDATE utente')) {
        const u = utenti.find(u => u.id === valori[1]);
        if (concorrente || u.password_hash !== valori[2] || u.ruolo !== 'USER') return [{ affectedRows: 0 }];
        const colonna = sql.includes('SET email') ? 'email' : 'password_hash';
        if (colonna === 'email' && utenti.some(a => a.id !== u.id && a.email === valori[0])) {
            throw Object.assign(new Error('SQL con email e hash'), { code: 'ER_DUP_ENTRY' });
        }
        u[colonna] = valori[0];
        return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO sessioni')) {
        sessioni.push({ id: sessioni.length + 100, utente_id: valori[0], device_id: valori[1], hash_token: valori[2] });
        return [{ affectedRows: 1 }];
    }
    throw new Error('Query non prevista nel test');
} };
const dbPath = require.resolve('../src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const creaApp = require('../src/app');
const limite = { prenota: () => ({ consentito: true }) };
let app;

before(async () => {
    hash = await bcrypt.hash(password, 4);
    app = creaApp({
        configurazioneWeb: { abilitata: true, origini: new Set(['http://localhost:5173']) },
        limitatoreAccount: limite,
        limitatoreRegistrazione: limite,
        limitiLogin: { inizia: () => ({ consentito: true, riuscito() {}, errore() {} }) },
    });
    server = await new Promise((r, reject) => { const s = app.listen(0, '127.0.0.1', errore => errore ? reject(errore) : r(s)); });
    origine = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
    utenti = [
        { id: 1, nome: 'Uno', email: 'uno@esempio.test', ruolo: 'USER', password_hash: hash },
        { id: 2, nome: 'Due', email: 'due@esempio.test', ruolo: 'USER', password_hash: hash },
    ];
    sessioni = [{ id: 10, utente_id: 1, device_id: device, hash_token: hashToken(token) }];
    query = []; guasto = false; concorrente = false; app.locals.limitiAccount = limite;
});
after(async () => { if (server) await new Promise(r => server.close(r)); });

async function chiama(percorso, corpo, headers = {}) {
    const risposta = await fetch(origine + '/api/auth' + percorso, {
        method: corpo ? (percorso === '/web/login' ? 'POST' : 'PATCH') : 'GET',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173',
            Cookie: cookie, 'X-CSRF-Token': generaCsrf(token), ...headers },
        body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return { status: risposta.status, headers: risposta.headers, dati: await risposta.json().catch(() => null) };
}
const email = { passwordCorrente: password, nuovaEmail: ' Nuova@esempio.test ', confermaEmail: 'nuova@esempio.test' };
const cambioPassword = { passwordCorrente: password, nuovaPassword: 'Password-nuova-456', confermaPassword: 'Password-nuova-456' };

test('email: aggiorna solo utente autenticato, sessione/CSRF invariati e login con nuova email', async () => {
    const precedenti = structuredClone(sessioni);
    const altro = structuredClone(utenti[1]);
    const r = await chiama('/email', email);
    assert.equal(r.status, 200);
    assert.deepEqual(r.dati.utente, { id: 1, nome: 'Uno', email: 'nuova@esempio.test', ruolo: 'USER' });
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(sessioni, precedenti);
    assert.deepEqual(utenti[1], altro);
    assert.equal((await chiama('/io')).dati.csrf, generaCsrf(token));
    assert.equal((await chiama('/web/login', { email: 'uno@esempio.test', password }, { Cookie: '' })).status, 401);
    assert.equal((await chiama('/web/login', { email: 'nuova@esempio.test', password }, { Cookie: '' })).status, 200);
});
test('email duplicata: 409 controllato, account invariato', async () => {
    const r = await chiama('/email', { ...email, nuovaEmail: 'due@esempio.test', confermaEmail: 'due@esempio.test' });
    assert.equal(r.status, 409); assert.equal(r.dati.codice, 'EMAIL_EXISTS');
    assert.equal(utenti[0].email, 'uno@esempio.test');
});
test('email non valida, conferma errata, corpo extra e tentativo di cambiare altro utente/ruolo: 400 senza UPDATE', async () => {
    for (const corpo of [
        { ...email, nuovaEmail: 'non-email' }, { ...email, confermaEmail: 'altro@esempio.test' },
        { ...email, id: 2 }, { ...email, ruolo: 'ADMIN' }, { ...email, nuovaEmail: 'x@waveset.test' },
    ]) assert.equal((await chiama('/email', corpo)).status, 400);
    assert(!query.some(q => q.sql.startsWith('UPDATE')));
});
test('password corrente errata: errore distinto dalla sessione scaduta, nessuna modifica', async () => {
    for (const path of ['/email', '/password']) {
        const r = await chiama(path, { ...(path === '/email' ? email : cambioPassword), passwordCorrente: 'sbagliata' });
        assert.equal(r.status, 400); assert.equal(r.dati.codice, 'CURRENT_PASSWORD_INVALID');
    }
    assert.equal((await chiama('/io')).status, 200);
    assert(!query.some(q => q.sql.startsWith('UPDATE')));
});
test('nuova password: lunghezza, byte bcrypt, lettere/numero o simbolo, conferma', async () => {
    for (const value of ['breve', 'sololetterelunghe', '12345678901234', '😀'.repeat(19) + 'A1', 'A'.repeat(71) + '12', 'valida-12\0pass']) {
        assert.equal((await chiama('/password', { ...cambioPassword, nuovaPassword: value, confermaPassword: value })).status, 400);
    }
    assert.equal((await chiama('/password', { ...cambioPassword, confermaPassword: 'diversa' })).status, 400);
    assert(!query.some(q => q.sql.startsWith('UPDATE')));
});
test('password: hash bcrypt reale, login nuovo valido/vecchio rifiutato, sessione invariata', async () => {
    const precedenti = structuredClone(sessioni);
    assert.equal((await chiama('/password', cambioPassword)).status, 204);
    assert.notEqual(utenti[0].password_hash, cambioPassword.nuovaPassword);
    assert.match(utenti[0].password_hash, /^\$2[ab]\$12\$/);
    assert(await bcrypt.compare(cambioPassword.nuovaPassword, utenti[0].password_hash));
    assert.deepEqual(sessioni, precedenti);
    assert.equal((await chiama('/io')).status, 200);
    assert.equal((await chiama('/web/login', { email: 'uno@esempio.test', password }, { Cookie: '' })).status, 401);
    assert.equal((await chiama('/web/login', { email: 'uno@esempio.test', password: cambioPassword.nuovaPassword }, { Cookie: '' })).status, 200);
});
test('autenticazione, ruolo USER, CSRF e Origin richiesti prima delle modifiche', async () => {
    assert.equal((await chiama('/email', email, { Cookie: '' })).status, 401);
    assert.equal((await chiama('/email', email, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await chiama('/password', cambioPassword, { Origin: 'https://estraneo.test' })).status, 403);
    utenti[0].ruolo = 'ADMIN';
    assert.equal((await chiama('/email', email)).status, 403);
    assert(!query.some(q => q.sql.startsWith('UPDATE')));
});
test('limite account: 429 prima del confronto password e dell’UPDATE', async () => {
    app.locals.limitiAccount = { prenota: () => ({ consentito: false, retryAfterSec: 42 }) };
    const r = await chiama('/password', cambioPassword);
    assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '42');
    assert(!query.some(q => q.sql.includes('FROM utente')));
});
test('guasto DB: 500 generico e log senza SQL/password/email/hash', async t => {
    guasto = true;
    const log = t.mock.method(console, 'error', () => {});
    const r = await chiama('/email', email);
    assert.equal(r.status, 500); assert.deepEqual(r.dati, { messaggio: 'Errore interno del server' });
    const testo = log.mock.calls.map(c => c.arguments.map(String).join(' ')).join(' ');
    for (const valore of [password, hash, email.nuovaEmail, 'SQL con dati riservati']) assert(!testo.includes(valore));
});
test('aggiornamento concorrente: hash confrontato nell’UPDATE, 409 senza sovrascrittura', async () => {
    concorrente = true;
    const r = await chiama('/email', email);
    assert.equal(r.status, 409); assert.equal(r.dati.codice, 'ACCOUNT_CHANGED');
    assert.equal(utenti[0].email, 'uno@esempio.test');
    assert(query.some(q => q.sql.includes('AND password_hash = ?') && q.valori[2] === hash));
});
test('validazione pura rifiuta valori non stringa e non espone gli input', () => {
    for (const corpo of [null, [], 'segreto', {}, { ...email, passwordCorrente: {} }]) {
        const r = validaCambio(corpo, 'email'); assert.equal(r.ok, false);
        assert(!JSON.stringify(r).includes(password));
    }
});
