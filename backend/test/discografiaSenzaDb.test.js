const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { creaClient } = require('../src/deezer/client');
const { brano, album } = require('../src/deezer/discografia');
const { classifica, classificazione } = require('../src/catalogo/classificazione');
const { artistaPubblico, DEMO, EVENTO_PUBBLICO } = require('../src/catalogo/pubblico');
const release = (id = 123, extra = {}) => ({ id, title: `Album ${id}`, type: 'album', record_type: 'ep', release_date: '2026-10-01',
    link: `https://www.deezer.com/album/${id}`, cover_big: 'https://cdn-images.dzcdn.net/images/cover/test/500x500.jpg', ...extra });
const track = { id: 12, title: 'Brano reale', type: 'track', link: 'https://www.deezer.com/track/12', album: release() };
test('Discografia: artwork ufficiale della pubblicazione, mai foto artista; link diretti del tipo corretto', () => {
    assert.equal(brano(track).copertinaUrl, release().cover_big);
    assert.equal(album(release()).tipo, 'ep');
    assert.equal(album(release()).dataPubblicazione, '2026-10-01');
    assert.equal(brano({ ...track, album: { picture_medium: release().cover_big } }).copertinaUrl, null);
    assert.equal(album(release(123, { release_date: '2026-99-99', cover_big: 'https://cdn-images.dzcdn.net/images/artist/foto.jpg' })).copertinaUrl, null);
    assert.equal(album(release(123, { release_date: '2026-99-99' })).dataPubblicazione, null);
    for (const extra of [{ link: 'https://www.deezer.com/track/123' }, { link: 'https://evil.test/album/123' }, { title: null }]) assert.throws(() => album(release(123, extra)));
});
test('Discografia: top 10, singoli/EP, ordine recente, paginazione ricostruita e cache condivisa', async () => {
    const chiamate = [];
    const c = creaClient({ env: {}, fetchImpl: async url => {
        chiamate.push(url);
        const u = new URL(url);
        if (u.pathname.endsWith('/top')) { assert.equal(u.searchParams.get('limit'), '10'); return Response.json({ data: [track], total: 40 }); }
        assert.equal(u.searchParams.get('order'), 'RELEASE_DATE_DESC');
        return Response.json({ data: Array.from({ length: 12 }, (_, i) => release(i + 1)), total: 25, next: 'https://evil.test/no' });
    } });
    const [a, b] = await Promise.all([c.discografia('3951'), c.discografia('3951')]);
    assert.equal(chiamate.length, 2); assert.deepEqual(a, b); assert.equal(a.brani.length, 1); assert.equal(a.prossimoIndice, 12);
    a.pubblicazioni[0].titolo = 'mutato'; assert.notEqual((await c.discografia('3951')).pubblicazioni[0].titolo, 'mutato');
    const seconda = await c.discografia('3951', 12); assert.equal(seconda.brani.length, 0); assert.equal(chiamate.length, 3);
    assert(chiamate.every(u => new URL(u).origin === 'https://api.deezer.com'));
    for (const indice of [-1, 13, 1212]) await assert.rejects(c.discografia('3951', indice));
});
test('Discografia: payload incompleto/duplicato e URL errato non diventano uscite inventate', async () => {
    for (const payload of [{ data: [], total: -1 }, { data: [track, track], total: 2 }, { data: [null], total: 1 }]) {
        const c = creaClient({ env: {}, fetchImpl: async u => Response.json(u.includes('/top?') ? payload : { data: [], total: 0 }) });
        await assert.rejects(c.discografia('3951'));
    }
});
test('Classificazione: tutti i 33 nomi esatti e Carl Cox, più generi; anteprima e applicazione idempotente', async () => {
    assert.equal(Object.keys(classificazione).length, 34);
    assert.deepEqual(classificazione['Tiësto'], ['Trance', 'House']);
    assert(DEMO.every(n => !classificazione[n]));
    const relazioni = [], generi = ['House', 'Techno', 'Trance', 'Drum and Bass'].map((nome, i) => ({ id: i + 1, nome }));
    const c = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {}, async query(sql, p) {
        if (sql.includes('FROM artista ORDER')) return [[{ id: 5, nome: 'Carl Cox' }, { id: 1, nome: DEMO[0] }]];
        if (sql.includes('FROM genere')) return [generi];
        if (sql.includes('FROM artista_genere')) return [relazioni];
        assert(sql.startsWith('INSERT IGNORE INTO artista_genere')); relazioni.push({ artista_id: p[0], genere_id: p[1] }); return [{}];
    } };
    const pool = { async getConnection() { return c; } };
    assert.equal((await classifica(pool)).nuoveAssociazioni, 2); assert.equal(relazioni.length, 0);
    assert.equal((await classifica(pool, true)).nuoveAssociazioni, 2);
    assert.equal((await classifica(pool, true)).nuoveAssociazioni, 0);
});
test('Catalogo pubblico: esclusione demo condivisa anche per eventi; alias non può introdurre SQL', () => {
    assert(DEMO.every(n => artistaPubblico().includes(n)));
    assert(EVENTO_PUBBLICO.includes('evento_artista'));
    assert.throws(() => artistaPubblico('a;DROP'));
});
test('API discografia: nessun lookup per artista senza link; soltanto ID Deezer confermato', async t => {
    const { creaRoute } = require('../src/routes/discografia');
    let linked = false, chiamate = 0;
    const app = express(); app.use(creaRoute({ pool: { async query(sql) { assert(sql.includes('NOT IN')); return [[{ id: 5, external_id: linked ? '3951' : null }]]; } },
        client: { async discografia(id, indice) { chiamate++; assert.equal(id, '3951'); assert.equal(indice, 0); return { brani: [track], pubblicazioni: [] }; } } }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    t.after(() => new Promise(r => server.close(r)));
    const url = `http://127.0.0.1:${server.address().port}/artisti/5/discografia`;
    assert.equal((await (await fetch(url)).json()).disponibile, false); assert.equal(chiamate, 0);
    linked = true; assert.equal((await (await fetch(url)).json()).disponibile, true); assert.equal(chiamate, 1);
    assert.equal((await fetch(url + '?indice=13')).status, 400);
});
