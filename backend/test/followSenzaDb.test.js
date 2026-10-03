// Route HTTP, autenticazione e CSRF reali; pool sintetico, nessun DB o .env.
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const { hashToken } = require('../src/autenticazione/token');
const { generaCsrf } = require('../src/autenticazione/csrf');
const device = '12345678-1234-4234-8234-123456789abc';
const token = 'a'.repeat(64);
let server, origine, follow, query, ruolo, utente, guasto;
const db = { async query(sql, valori = []) {
    query.push({ sql, valori });
    if (sql.includes('FROM sessioni')) return [[{ id: 10, utente_id: utente, hash_token: hashToken(token), valida: 1, ruolo }]];
    if (guasto && !sql.includes('FROM sessioni')) throw new Error('SQL con credenziali interne');
    if (sql.includes('SELECT 1 FROM artista')) return [Number(valori[0]) <= 2 ? [{}] : []];
    if (sql.startsWith('INSERT IGNORE')) { follow.add(`${valori[0]}:${valori[1]}`); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('DELETE FROM utente_artista')) { follow.delete(`${valori[0]}:${valori[1]}`); return [{ affectedRows: 1 }]; }
    if (sql.includes('SELECT 1 FROM utente_artista')) return [follow.has(`${valori[0]}:${valori[1]}`) ? [{}] : []];
    if (sql.includes('FROM artista WHERE')) return [[{ id: Number(valori[0]), nome: 'Artista', bio: null, immagine_url: null }]];
    if (sql.includes('FROM evento e') && sql.includes('CURDATE()')) {
        const eventi = [{ id: 1, titolo: 'Principale', data_evento: '2027-01-01', latitudine: '45', longitudine: '9' }, { id: 2, titolo: 'Con ospite', data_evento: '2027-01-02', latitudine: null, longitudine: null }];
        return [sql.includes('INNER JOIN utente_artista ua') ? eventi.filter(e => (e.id === 1 ? [1] : [1, 2]).some(id => follow.has(`${valori[0]}:${id}`))) : eventi];
    }
    if (sql.includes('SELECT ea.evento_id')) return [[...valori[0].flatMap(id => (id === 1 ? [1] : [1, 2]).map(a => ({ evento_id: id, id: a, nome: `Artista ${a}`, immagine_url: null })))]];
    if (sql.includes('FROM genere') || sql.includes('FROM brano') || sql.includes('FROM album') || sql.includes('INNER JOIN evento_artista')) return [[]];
    throw new Error('Query non prevista');
} };
const dbPath = require.resolve('../src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const creaApp = require('../src/app');
const limite = { prenota: () => ({ consentito: true }) };
before(async () => {
    const app = creaApp({ configurazioneWeb: { abilitata: true, origini: new Set(['http://localhost:5173']) }, limitatoreAccount: limite, limitatoreRegistrazione: limite });
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', e => e ? reject(e) : resolve(s)); });
    origine = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { follow = new Set(); query = []; ruolo = 'USER'; utente = 1; guasto = false; });
after(async () => { if (server) await new Promise(r => server.close(r)); });
async function chiama(percorso, method = 'GET', headers = {}, body) {
    const r = await fetch(origine + '/api' + percorso, { method, headers: {
        Cookie: `waveset_sid=${device}.${token}`, Origin: 'http://localhost:5173',
        'X-CSRF-Token': generaCsrf(token), 'Content-Type': 'application/json', ...headers,
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, dati: await r.json().catch(() => null), headers: r.headers };
}
test('follow duplicato e unfollow inesistente sono idempotenti, dettaglio aggiornato', async () => {
    for (let i = 0; i < 2; i++) assert.equal((await chiama('/artisti/1/segui', 'PUT')).status, 204);
    assert.deepEqual([...follow], ['1:1']);
    const dettaglio = await chiama('/artisti/1');
    assert.equal(dettaglio.dati.seguito, true); assert.equal(dettaglio.headers.get('cache-control'), 'no-store');
    for (let i = 0; i < 2; i++) assert.equal((await chiama('/artisti/1/segui', 'DELETE')).status, 204);
    assert.equal(follow.size, 0); assert.equal((await chiama('/artisti/1')).dati.seguito, false);
    assert.equal((await chiama('/artisti/99999/segui', 'DELETE')).status, 204);
});
test('artista inesistente: follow 404, nessun inserimento', async () => {
    assert.equal((await chiama('/artisti/99999/segui', 'PUT')).status, 404);
    assert.equal(follow.size, 0);
});
test('isolamento: identità solo dalla sessione, unfollow non modifica altri utenti', async () => {
    await chiama('/artisti/1/segui', 'PUT', {}, { utente_id: 2, ruolo: 'ADMIN' });
    utente = 2;
    assert.equal((await chiama('/artisti/1')).dati.seguito, false);
    await chiama('/artisti/1/segui', 'DELETE');
    assert.deepEqual([...follow], ['1:1']);
});
test('ospiti, ADMIN, CSRF e origine errata: mutazioni vietate', async () => {
    for (const method of ['PUT', 'DELETE']) {
        assert.equal((await chiama('/artisti/1/segui', method, { Cookie: '' })).status, 401);
        assert.equal((await chiama('/artisti/1/segui', method, { 'X-CSRF-Token': '' })).status, 403);
        assert.equal((await chiama('/artisti/1/segui', method, { Origin: 'https://estraneo.test' })).status, 403);
        ruolo = 'ADMIN'; assert.equal((await chiama('/artisti/1/segui', method)).status, 403); ruolo = 'USER';
    }
    assert(!query.some(q => /INSERT|DELETE FROM utente_artista/.test(q.sql)));
});
test('trasporto bearer esistente conservato', async () => {
    const headers = { Cookie: '', Authorization: `Bearer ${token}`, 'X-Device-Id': device, Origin: '', 'X-CSRF-Token': '' };
    assert.equal((await chiama('/artisti/1/segui', 'PUT', headers)).status, 204);
    assert.equal((await chiama('/artisti/1/segui', 'DELETE', headers)).status, 204);
});
test('ID malformed, zero, negativo, decimale e fuori INT: 400 senza scritture', async () => {
    for (const id of ['zero', '0', '-1', '1.5', '01', '2147483648', '9007199254740992']) {
        for (const method of ['PUT', 'DELETE']) assert.equal((await chiama(`/artisti/${id}/segui`, method)).status, 400);
    }
    assert.equal(follow.size, 0);
});
test('errore DB follow/unfollow: 500 generico, log senza dettagli SQL', async t => {
    guasto = true;
    const log = t.mock.method(console, 'error', () => {});
    for (const method of ['PUT', 'DELETE']) {
        const r = await chiama('/artisti/1/segui', method);
        assert.equal(r.status, 500); assert.deepEqual(r.dati, { messaggio: 'Errore interno del server' });
    }
    assert(!log.mock.calls.some(c => c.arguments.map(String).join(' ').includes('SQL con credenziali')));
});
test('filtro SQL seguiti: nessun follow, artista secondario, nessun duplicato e isolamento', async () => {
    assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati, []);
    await chiama('/artisti/2/segui', 'PUT');
    assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati.map(e => e.id), [2]);
    await chiama('/artisti/1/segui', 'PUT');
    assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati.map(e => e.id), [1, 2]);
    utente = 2; assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati, []);
    assert.equal((await chiama('/eventi?filtro=seguiti', 'GET', { Cookie: '' })).status, 401);
    assert.equal((await chiama('/eventi?filtro=tutti', 'GET', { Cookie: '' })).dati.length, 2);
});
