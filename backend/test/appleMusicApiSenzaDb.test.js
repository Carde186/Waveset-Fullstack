const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const { hashToken } = require('../src/autenticazione/token');
const { generaCsrf } = require('../src/autenticazione/csrf');
const { ErroreAppleMusic } = require('../src/appleMusic/errore');
const device = '12345678-1234-4234-8234-123456789abc', token = 'e'.repeat(64);
let ruolo = 'ADMIN', server, base, chiamate, guasto;
const db = { async query(sql) {
    if (sql.includes('FROM sessioni')) return [[{ id: 10, utente_id: 3, hash_token: hashToken(token), valida: 1, ruolo }]];
    throw new Error('Query inattesa');
} };
const dbPath = require.resolve('../src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const creaApp = require('../src/app');
const profilo = { externalId: '123', name: 'Apple', storefront: 'it', url: 'https://music.apple.com/it/artist/test/123', artwork: null, genres: [], syncedAt: '2026-10-03T10:00:00Z', versione: 1 };
const service = Object.fromEntries(['leggi', 'cerca', 'collega', 'sincronizza'].map(azione => [azione, async (...args) => {
    chiamate.push([azione, ...args]); if (guasto) throw guasto;
    return azione === 'leggi' ? { artista: { id: args[0], nome: 'Locale' }, collegamento: profilo } : azione === 'cerca' ? { risultati: [profilo] } : profilo;
}]));
const limite = { prenota: () => ({ consentito: true }) };
before(async () => {
    const app = creaApp({ appleMusicService: service, configurazioneWeb: { abilitata: true, origini: new Set(['http://localhost:5174']) }, limitatoreAccount: limite, limitatoreRegistrazione: limite });
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', e => e ? reject(e) : resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}/api/admin/artisti`;
});
beforeEach(() => { ruolo = 'ADMIN'; chiamate = []; guasto = null; });
after(async () => { if (server) await new Promise(r => server.close(r)); });
async function chiama(path, method = 'GET', body, headers = {}) {
    const r = await fetch(base + path, { method, headers: { Cookie: `waveset_sid=${device}.${token}`, Origin: 'http://localhost:5174',
        'X-CSRF-Token': generaCsrf(token), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, dati: await r.json(), headers: r.headers };
}
test('ADMIN: dettaglio, ricerca, conferma e sync JSON/no-store', async () => {
    assert.equal((await chiama('/1/apple-music')).dati.collegamento.externalId, '123');
    const ricerca = await chiama('/1/apple-music/search?q=Artista');
    assert.equal(ricerca.status, 200); assert.equal(ricerca.headers.get('cache-control'), 'no-store');
    assert.equal((await chiama('/1/apple-music/collegamento', 'POST', { external_id: '123', versione_attesa: null })).status, 200);
    assert.equal((await chiama('/1/apple-music/sincronizza', 'POST', { versione_attesa: 1 })).status, 200);
    assert.deepEqual(chiamate[1], ['cerca', 1, 'Artista']);
    assert(!JSON.stringify(ricerca.dati).includes('raw'));
});
test('ospite/USER bloccati su tutte le route; POST richiede CSRF e origine corretti', async () => {
    for (const [path, method] of [['/1/apple-music', 'GET'], ['/1/apple-music/search?q=test', 'GET'], ['/1/apple-music/collegamento', 'POST'], ['/1/apple-music/sincronizza', 'POST']]) {
        assert.equal((await chiama(path, method, undefined, { Cookie: '' })).status, 401);
        ruolo = 'USER'; assert.equal((await chiama(path, method)).status, 403); ruolo = 'ADMIN';
        if (method === 'POST') {
            assert.equal((await chiama(path, method, undefined, { 'X-CSRF-Token': '' })).status, 403);
            assert.equal((await chiama(path, method, undefined, { Origin: 'https://estraneo.test' })).status, 403);
        }
    }
    assert.equal(chiamate.length, 0);
});
test('ID invalidi fermati prima del service', async () => {
    for (const id of ['0', 'abc', '-1', '01', '1.1', '2147483648']) assert.equal((await chiama(`/${id}/apple-music`)).status, 400);
    assert.equal(chiamate.length, 0);
});
test('codici configurazione/notfound/conflitti/Apple chiari; errore interno non esposto o loggato', async t => {
    const log = []; t.mock.method(console, 'error', (...args) => log.push(args));
    for (const [codice, status] of [['APPLE_CONFIGURAZIONE', 503], ['ARTISTA_NON_TROVATO', 404], ['APPLE_NON_TROVATO', 404], ['APPLE_GIA_COLLEGATO', 409], ['APPLE_CONFLITTO', 409], ['APPLE_TIMEOUT', 503], ['APPLE_AUTORIZZAZIONE', 502]]) {
        guasto = new ErroreAppleMusic(codice, status);
        const r = await chiama('/1/apple-music'); assert.equal(r.status, status); assert.equal(r.dati.codice, codice);
    }
    guasto = new Error('PEM Authorization SECRET interno');
    const r = await chiama('/1/apple-music/collegamento', 'POST', {}); assert.equal(r.status, 500);
    assert.equal(r.dati.codice, 'APPLE_SERVER'); assert(!JSON.stringify(r).includes('SECRET')); assert.equal(log.length, 0);
});
