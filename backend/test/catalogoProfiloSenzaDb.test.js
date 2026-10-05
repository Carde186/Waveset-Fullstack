const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const express = require('express');
const { biografia, popolaritaDeezer } = require('../src/catalogo/profiloPubblico');
const biografie = require('../src/catalogo/biografie.json');
const { classificazione } = require('../src/catalogo/classificazione');
let server, url, query, bio, fan, nome;
const lineup = new Map([[1, [38]], [2, [38, 15]], [3, [10]]]);
const generi = new Map([[38, [1, 2]], [15, [1]], [10, [4]]]);
const db = { async query(sql, valori = []) {
    query.push({ sql, valori });
    if (sql.startsWith('SELECT artista_id, immagine_url')) return [[]];
    if (sql.includes('dati_normalizzati_json')) return [sql.includes("provider = 'deezer'") && fan !== undefined ? [{
        versione: 1, dati_normalizzati_json: { externalId: '3951', name: nome, fan, url: 'https://www.deezer.com/artist/3951',
            syncedAt: '2026-10-05T10:00:00Z', raw: { interno: 'NON_ESPORRE' } },
    }] : []];
    if (sql.includes('FROM artista WHERE')) return [[{ id: 38, nome, bio, immagine_url: null }]];
    if (sql.includes('FROM evento e') && sql.includes('genere_ea')) {
        // Modello relazionale indipendente dalla query: intersezione con qualunque
        // artista in lineup, ID univoco anche con due corrispondenze.
        return [[...lineup].filter(([, artisti]) => artisti.some(a => generi.get(a).includes(valori[0])))
            .map(([id]) => ({ id, titolo: `Evento ${id}`, data_evento: '2027-01-01', ora_evento: null,
                luogo: null, citta: null, latitudine: null, longitudine: null }))];
    }
    if (sql.includes('SELECT ea.evento_id')) return [valori[0].flatMap(id => lineup.get(id).map(a => ({ evento_id: id, id: a, nome: `Artista ${a}`, immagine_url: null })))];
    if (sql.includes('FROM genere') || sql.includes('FROM brano') || sql.includes('FROM album') || sql.includes('FROM evento e')) return [[]];
    throw new Error('Query non prevista nel test');
} };
const dbPath = require.resolve('../src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
before(async () => {
    const app = express();
    app.use('/api', require('../src/routes/eventi'));
    app.use('/api', require('../src/routes/artisti'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    url = `http://127.0.0.1:${server.address().port}/api`;
});
beforeEach(() => { query = []; bio = null; fan = undefined; nome = 'Carl Cox'; });
after(async () => { if (server) await new Promise(r => server.close(r)); });
test('biografie: tutti gli artisti reali, IT/EN e fonte; bio curata conserva la priorità', () => {
    assert.deepEqual(Object.keys(biografie).sort(), Object.keys(classificazione).sort());
    for (const b of Object.values(biografie)) {
        assert(b.it.length > 40 && b.en.length > 40);
        assert.equal(new URL(b.fonteUrl).protocol, 'https:');
    }
    assert.equal(biografia('Carl Cox', 'Testo curato.'), null);
    assert.equal(biografia('Sconosciuto', null), null);
    assert.equal(biografia('Carl Cox', '  ').it, biografie['Carl Cox'].it);
});
test('fan Deezer: zero reale distinto da dato assente; niente raw o ascolti inventati', () => {
    for (const fan of [undefined, null, -1, 1.5, '12']) assert.equal(popolaritaDeezer({ fan }), null);
    assert.equal(popolaritaDeezer(null), null);
    assert.deepEqual(popolaritaDeezer({ fan: 0, url: 'https://www.deezer.com/artist/3951', syncedAt: '2026-10-05T10:00:00Z', raw: {} }),
        { fan: 0, url: 'https://www.deezer.com/artist/3951', aggiornato_at: '2026-10-05T10:00:00Z' });
});
test('API pubblica artista: bio verificata e soli fan del link Deezer salvato, nessuna scrittura/rete esterna', async () => {
    fan = 12345;
    const r = await fetch(url + '/artisti/38'); assert.equal(r.status, 200);
    const dati = await r.json();
    assert.deepEqual(dati.biografia, biografie['Carl Cox']);
    assert.equal(dati.popolarita_deezer.fan, 12345);
    assert(!JSON.stringify(dati).includes('NON_ESPORRE'));
    assert(query.every(q => q.sql.startsWith('SELECT')));
    bio = 'Bio già curata.';
    assert.equal((await (await fetch(url + '/artisti/38')).json()).biografia, null);
    fan = undefined;
    assert.equal((await (await fetch(url + '/artisti/38')).json()).popolarita_deezer, null);
});
test('eventi per genere: pubblico, artista secondario, più corrispondenze senza duplicati e generi vuoti', async () => {
    const ids = async g => { const r = await fetch(url + '/eventi?filtro=tutti&genere_id=' + g); assert.equal(r.status, 200); return (await r.json()).map(e => e.id); };
    assert.deepEqual(await ids(1), [1, 2]);
    assert.deepEqual(await ids(4), [3]);
    assert.deepEqual(await ids(3), []);
    const q = query.find(q => q.sql.includes('genere_ea'));
    assert(q.sql.includes('EXISTS (SELECT 1 FROM evento_artista genere_ea'));
    assert(q.sql.includes('ollama_evento_job'));
    assert(q.sql.includes("e.stato = 'pubblicato'"));
    assert.deepEqual(q.valori, [1]);
});
test('genere invalido/duplicato: 400 prima del DB; API seguiti continua a richiedere sessione', async () => {
    for (const genere of ['0', '-1', '1.5', '2147483648', 'no', '1&genere_id=2']) assert.equal((await fetch(url + '/eventi?genere_id=' + genere)).status, 400);
    assert.equal(query.length, 0);
    assert.equal((await fetch(url + '/eventi?filtro=seguiti')).status, 401);
});
