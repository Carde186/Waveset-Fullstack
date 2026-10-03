// HTTP, ruoli, cookie e CSRF reali; DB in memoria, nessuna scrittura persistente.
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const { hashToken } = require('../src/autenticazione/token');
const { generaCsrf } = require('../src/autenticazione/csrf');
const token = 'b'.repeat(64);
const device = '12345678-1234-4234-8234-123456789abc';
let server, base, evento, artista, fonte, ruolo, query, guasto;
const db = { async query(sql, valori = []) {
    query.push({ sql, valori });
    if (sql.includes('FROM sessioni')) return [[{ id: 10, utente_id: 3, hash_token: hashToken(token), valida: 1, ruolo }]];
    if (guasto) throw Object.assign(new Error('Errore interno SQL riservato'), { code: 'ER_TEST' });
    if (sql.includes('SELECT ea.evento_id')) return [[{ evento_id: evento.id, ...artista }]];
    if (sql.includes('SELECT id_attraction_ticketmaster FROM evento_artista')) return [Number(valori[0]) === evento.id && Number(valori[1]) === artista.id ? [{ id_attraction_ticketmaster: artista.id_attraction_ticketmaster }] : []];
    if (sql.includes('FROM evento WHERE id')) return [Number(valori[0]) === evento.id && (!sql.includes("stato = 'in_coda'") || evento.stato === 'in_coda') ? [{ ...evento }] : []];
    if (sql.includes('FROM evento') && sql.includes("WHERE stato = 'in_coda'")) return [evento.stato === 'in_coda' ? [{ ...evento }] : []];
    if (sql.includes('FROM ticketmaster_evento_fonte')) return [[{ ...fonte }]];
    if (sql.startsWith('UPDATE artista')) {
        if (artista.id_ticketmaster !== null && artista.id_ticketmaster !== valori[0]) return [{ affectedRows: 0 }];
        artista.id_ticketmaster = valori[0]; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE evento')) {
        if (evento.stato !== 'in_coda') return [{ affectedRows: 0 }];
        evento.stato = sql.includes("e.stato = 'pubblicato'") ? 'pubblicato' : 'scartato';
        evento.motivo_revisione = evento.stato === 'scartato' ? valori[0] : null;
        fonte.protetto_admin = true; return [{ affectedRows: 1 }];
    }
    throw new Error('Query non prevista');
} };
const dbPath = require.resolve('../src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const creaApp = require('../src/app');
const limite = { prenota: () => ({ consentito: true }) };
before(async () => {
    const app = creaApp({ configurazioneWeb: { abilitata: true, origini: new Set(['http://localhost:5174']) }, limitatoreAccount: limite, limitatoreRegistrazione: limite });
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', e => e ? reject(e) : resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/admin/eventi`;
});
beforeEach(() => {
    evento = { id: 1, titolo: 'Evento test', data_evento: '2027-10-09', ora_evento: null, luogo: 'Club', citta: 'Roma', latitudine: 41.9, longitudine: 12.5,
        fonte: 'ticketmaster', stato: 'in_coda', motivo_revisione: 'lineup_non_confermato' };
    artista = { id: 5, nome: 'Artista', id_ticketmaster: null, id_attraction_ticketmaster: 'attr-5' };
    fonte = { snapshot: { id_esterno: 'evt-1', attractions: [{ id: 'attr-5', nome: 'Artista', url: 'https://ticketmaster.com/artist/5' }] },
        stato_fonte: 'onsale', protetto_admin: false, modifiche_fonte: false, ultimo_controllo: '2026-10-03T15:55:57Z', assente_dal: null };
    ruolo = 'ADMIN'; query = []; guasto = false;
});
after(async () => { if (server) await new Promise(r => server.close(r)); });
async function chiama(path, method = 'GET', body, headers = {}) {
    const r = await fetch(base + path, { method, headers: { Cookie: `waveset_sid=${device}.${token}`, Origin: 'http://localhost:5174',
        'X-CSRF-Token': generaCsrf(token), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, dati: await r.json().catch(() => null), headers: r.headers };
}
test('coda e dettaglio includono fonte/stato/candidati; snapshot resta separato e no-store', async () => {
    const r = await chiama('/coda');
    assert.equal(r.status, 200); assert.equal(r.dati[0].fonte, 'ticketmaster'); assert.equal(r.dati[0].stato, 'in_coda');
    assert.equal(r.dati[0].lineup[0].id_attraction_ticketmaster, 'attr-5');
    assert.equal(r.dati[0].lineup[0].collegamento_da_confermare, true);
    assert.equal((await chiama('/1')).dati.id, 1);
    const sf = await chiama('/1/fonte'); assert.equal(sf.headers.get('cache-control'), 'no-store');
    assert.deepEqual(sf.dati.snapshot, fonte.snapshot);
});
test('conferma esplicita idempotente, poi approva, conserva la decisione e il dettaglio', async () => {
    for (let i = 0; i < 2; i++) assert.equal((await chiama('/1/artisti/5/conferma-collegamento', 'POST')).status, 204);
    assert.equal(artista.id_ticketmaster, 'attr-5'); assert.equal(evento.stato, 'in_coda');
    assert.equal((await chiama('/1/approva', 'POST')).status, 204);
    assert.equal(evento.stato, 'pubblicato'); assert.equal(fonte.protetto_admin, true);
    assert.equal((await chiama('/1')).dati.stato, 'pubblicato');
    assert.equal((await chiama('/coda')).dati.length, 0);
    assert.equal((await chiama('/1/approva', 'POST')).status, 404);
});
test('approvazione non conferma il collegamento implicitamente', async () => {
    assert.equal((await chiama('/1/approva', 'POST')).status, 204); assert.equal(artista.id_ticketmaster, null);
});
test('conferma conflittuale non sovrascrive la decisione precedente; relazione errata non scrive', async () => {
    artista.id_ticketmaster = 'confermato-diverso';
    assert.equal((await chiama('/1/artisti/5/conferma-collegamento', 'POST')).status, 409);
    assert.equal(artista.id_ticketmaster, 'confermato-diverso');
    assert.equal((await chiama('/1/artisti/99/conferma-collegamento', 'POST')).status, 400);
});
test('rifiuto con motivazione validata archivia e protegge; senza motivo resta retrocompatibile', async () => {
    for (const motivo of [null, 4, {}, 'x'.repeat(256)]) assert.equal((await chiama('/1/scarta', 'POST', { motivo })).status, 400);
    assert.equal(evento.stato, 'in_coda');
    assert.equal((await chiama('/1/scarta', 'POST', { motivo: ' Doppione verificato ' })).status, 204);
    assert.equal(evento.stato, 'scartato'); assert.equal(evento.motivo_revisione, 'Doppione verificato'); assert.equal(fonte.protetto_admin, true);
    assert.equal((await chiama('/1')).dati.motivo_revisione, 'Doppione verificato');
});
test('scarto senza corpo e snapshot dopo lo scarto', async () => {
    assert.equal((await chiama('/1/scarta', 'POST')).status, 204);
    assert.equal((await chiama('/1/fonte')).status, 200);
    assert.equal((await chiama('/1/artisti/5/conferma-collegamento', 'POST')).status, 404);
});
test('coordinate mancanti e annullamento bloccano la pubblicazione', async () => {
    evento.latitudine = null; assert.equal((await chiama('/1/approva', 'POST')).status, 400);
    evento.latitudine = 41.9; fonte.stato_fonte = 'canceled'; assert.equal((await chiama('/1/approva', 'POST')).status, 400);
    assert.equal(evento.stato, 'in_coda');
});
test('ospite/USER, CSRF e origine errata: nessuna mutazione su tutti gli endpoint', async () => {
    for (const path of ['/1/approva', '/1/scarta', '/1/artisti/5/conferma-collegamento']) {
        assert.equal((await chiama(path, 'POST', undefined, { Cookie: '' })).status, 401);
        ruolo = 'USER'; assert.equal((await chiama(path, 'POST')).status, 403); ruolo = 'ADMIN';
        assert.equal((await chiama(path, 'POST', undefined, { 'X-CSRF-Token': '' })).status, 403);
        assert.equal((await chiama(path, 'POST', undefined, { Origin: 'https://estraneo.test' })).status, 403);
    }
    assert.equal(query.some(q => q.sql.startsWith('UPDATE')), false);
});
test('ID invalido o fuori INT e evento inesistente: niente scritture', async () => {
    for (const id of ['abc', '0', '-1', '1.2', '01', '2147483648']) assert.equal((await chiama(`/${id}/approva`, 'POST')).status, 400);
    assert.equal((await chiama('/1/artisti/zero/conferma-collegamento', 'POST')).status, 400);
    assert.equal((await chiama('/99')).status, 404);
    assert.equal(query.some(q => q.sql.startsWith('UPDATE')), false);
});
test('errore DB: risposta e log generici senza dettagli interni', async t => {
    guasto = true;
    const log = []; t.mock.method(console, 'error', (...args) => log.push(args.join(' ')));
    for (const path of ['/1/approva', '/1/scarta', '/1/artisti/5/conferma-collegamento']) {
        const r = await chiama(path, 'POST'); assert.equal(r.status, 500);
        assert(!JSON.stringify(r.dati).includes('SQL riservato'));
    }
    assert(!log.join(' ').includes('SQL riservato')); assert.equal(evento.stato, 'in_coda');
});
