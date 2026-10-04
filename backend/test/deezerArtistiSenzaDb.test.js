const assert = require('node:assert/strict');
const { test } = require('node:test');
const { creaClient } = require('../src/deezer/client');
const artista = (extra = {}) => ({ id: 3951, type: 'artist', name: 'Carl Cox', link: 'https://www.deezer.com/artist/3951',
    nb_fan: 200, picture_small: 'https://cdn-images.dzcdn.net/images/artist/a/56x56.jpg',
    picture_medium: 'https://cdn-images.dzcdn.net/images/artist/a/250x250.jpg', ...extra });
const json = (v, status = 200, headers) => new Response(JSON.stringify(v), { status, headers });
function client(fetchImpl, extra = {}) { return creaClient({ env: {}, fetchImpl, attendi: async () => {}, ...extra }); }
const codice = v => e => e.codice === v;
test('Deezer: ricerca solo artisti, normalizzazione, immagine medium e generi assenti', async () => {
    const c = client(async (u, o) => {
        const url = new URL(u); assert.equal(url.origin, 'https://api.deezer.com');
        assert.equal(url.pathname, '/search/artist'); assert.equal(url.searchParams.get('q'), 'Carl Cox');
        assert.equal(o.headers.Authorization, undefined); assert.equal(url.searchParams.get('apikey'), null);
        return json({ data: [artista()] });
    });
    const [r] = await c.cerca('Carl Cox');
    assert.equal(r.provider, 'deezer'); assert.equal(r.externalId, '3951'); assert.equal(r.fan, 200);
    assert.equal(r.artwork.width, 250); assert.equal(r.immagine, r.artwork.url); assert.deepEqual(r.genres, []);
    assert.equal(r.storefront, ''); assert.equal(r.raw.id, 3951); assert(Number.isFinite(Date.parse(r.syncedAt)));
});
test('Deezer: dettaglio ID, URL sicuri, immagine/fan mancanti e generi opzionali', async () => {
    const c = client(async u => { assert.equal(new URL(u).pathname, '/artist/3951'); return json(artista({ picture_medium: null, picture_small: null, nb_fan: undefined, genres: { data: [{ name: 'Electronic' }] } })); });
    const r = await c.dettaglio('3951'); assert.equal(r.artwork, null); assert.equal(r.fan, null); assert.deepEqual(r.genres, ['Electronic']);
    await assert.rejects(client(async () => json(artista({ link: 'https://other.example/3951' }))).dettaglio('3951'), codice('DEEZER_DATI_INVALIDI'));
});
test('Deezer: risultati vuoti validi, campi obbligatori e ID inatteso rifiutati', async () => {
    assert.deepEqual(await client(async () => json({ data: [] })).cerca('Nome'), []);
    for (const payload of [{ data: {} }, { data: [artista({ name: undefined })] }, { data: [artista(), artista()] }]) {
        await assert.rejects(client(async () => json(payload)).cerca('Nome'), codice('DEEZER_DATI_INVALIDI'));
    }
    await assert.rejects(client(async () => json(artista({ id: 2 }))).dettaglio('3951'), codice('DEEZER_DATI_INVALIDI'));
});
test('Deezer: errori nel corpo anche su HTTP 200; nessun messaggio remoto esposto', async () => {
    for (const [code, atteso] of [[800, 'DEEZER_NON_TROVATO'], [4, 'DEEZER_LIMITE'], [300, 'DEEZER_RISPOSTA']]) {
        let n = 0; const c = client(async () => { n++; return json({ error: { code, message: 'remote SECRET' } }); });
        await assert.rejects(c.cerca('Carl'), e => { assert(!e.message.includes('SECRET')); return e.codice === atteso; });
        assert.equal(n, code === 4 ? 2 : 1);
    }
});
test('Deezer: retry massimo uno su 429/5xx/rete, ripresa e Retry-After lungo', async () => {
    for (const status of [429, 500, 503]) {
        let n = 0; const c = client(async () => ++n === 1 ? json({}, status) : json(artista()));
        assert.equal((await c.dettaglio('3951')).name, 'Carl Cox'); assert.equal(n, 2);
    }
    let n = 0;
    await assert.rejects(client(async () => { n++; return json({}, 429, { 'Retry-After': '60' }); }).cerca('Carl'), codice('DEEZER_LIMITE')); assert.equal(n, 1);
    n = 0; await assert.rejects(client(async () => { n++; throw new Error('network secret'); }).cerca('Carl'), codice('DEEZER_RETE')); assert.equal(n, 2);
});
test('Deezer: timeout interrompe fetch, retry limitato e JSON inatteso non ripetuto', async () => {
    let n = 0;
    const c = client(async (_u, o) => new Promise((_resolve, reject) => { n++; o.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); }), { env: { DEEZER_TIMEOUT_MS: '10' } });
    await assert.rejects(c.cerca('Carl'), codice('DEEZER_TIMEOUT')); assert.equal(n, 2);
    for (const body of ['not json', 'null', '[]']) {
        n = 0; await assert.rejects(client(async () => { n++; return new Response(body); }).cerca('Carl'), codice('DEEZER_DATI_INVALIDI')); assert.equal(n, 1);
    }
});
test('Deezer: cache breve e coalescenza, copie isolate, scadenza e limitatore condiviso', async () => {
    let n = 0, tempo = 1000;
    const c = client(async () => { n++; return json({ data: [artista()] }); }, { ora: () => tempo, cacheMs: 100 });
    const risultati = await Promise.all([c.cerca('Carl Cox'), c.cerca('carl cox')]); assert.equal(n, 1);
    risultati[0][0].name = 'Mutato'; assert.equal((await c.cerca('Carl Cox'))[0].name, 'Carl Cox');
    tempo += 101; await c.cerca('Carl Cox'); assert.equal(n, 2);
    const limitato = client(async () => json(artista()), { ora: () => 1000, maxRichieste: 1 });
    await limitato.dettaglio('3951'); await assert.rejects(limitato.dettaglio('3951'), codice('DEEZER_LIMITE'));
});
test('Deezer: parametri e configurazione invalidi non effettuano HTTP', async () => {
    const c = client(() => { throw new Error('Non deve chiamare HTTP'); });
    for (const q of [null, '', ' '.repeat(3), 'x'.repeat(201)]) await assert.rejects(c.cerca(q), codice('DEEZER_PARAMETRI'));
    for (const id of [null, '01', '0', '../test', '9007199254740993']) await assert.rejects(c.dettaglio(id), codice('DEEZER_PARAMETRI'));
    assert.throws(() => creaClient({ env: { DEEZER_TIMEOUT_MS: '-1' } }), codice('DEEZER_CONFIGURAZIONE'));
});
