const assert = require('node:assert/strict');
const { test } = require('node:test');
const { immaginiArtisti, scegliImmagine } = require('../src/artistiProvider/immagini');
test('Immagini: unica priorità provider/local/null, stringhe vuote ignorate', () => {
    assert.equal(scegliImmagine(' https://foto.test/provider.jpg ', 'locale'), 'https://foto.test/provider.jpg');
    assert.equal(scegliImmagine(' ', 'locale'), 'locale');
    assert.equal(scegliImmagine(null, null), null); assert.equal(scegliImmagine(null, ''), null);
});
test('Immagini: un batch, provider attivo solo, duplicati/ordine immutati e provenienza', async () => {
    const chiamate = [], righe = [{ id: 5, nome: 'Carl', immagine_url: 'locale' }, { id: 6, nome: 'Altro', immagine_url: 'locale2' }, { id: 5, nome: 'Carl', immagine_url: 'locale' }, { id: 7, immagine_url: null }];
    const pool = { async query(sql, valori) { chiamate.push([sql, valori]); return [[{ artista_id: 5, immagine_url: 'provider' }, { artista_id: 6, immagine_url: '' }]]; } };
    const r = await immaginiArtisti(righe, { pool, env: {} });
    assert.equal(chiamate.length, 1); assert.deepEqual(chiamate[0][1], ['deezer', [5, 6, 7]]);
    assert.deepEqual(r.map(a => a.immagine_url), ['provider', 'locale2', 'provider', null]);
    assert.deepEqual(r.map(a => a.immagine_provider), ['deezer', null, 'deezer', null]);
    assert.equal(righe[0].immagine_url, 'locale');
    await assert.rejects(immaginiArtisti(righe, { pool, env: { ARTISTI_PROVIDER: 'apple_music' } }), e => e.codice === 'PROVIDER_CONFIGURAZIONE');
    assert.equal(chiamate.length, 1); // nessuna lettura di profili del provider ritirato
});
test('Immagini: alias nested brani/album, vuoto senza query e volume pre-migrazione', async () => {
    let n = 0;
    const pool = { async query() { n++; throw Object.assign(new Error('table'), { code: 'ER_NO_SUCH_TABLE' }); } };
    assert.deepEqual(await immaginiArtisti([], { pool }), []); assert.equal(n, 0);
    const [r] = await immaginiArtisti([{ artista_id: 5, artista_immagine_url: 'locale' }], { pool, campoId: 'artista_id', campoImmagine: 'artista_immagine_url' });
    assert.equal(r.artista_immagine_url, 'locale'); assert.equal(r.immagine_provider, null);
    await assert.rejects(immaginiArtisti([{ id: 5 }], { pool: { async query() { throw new Error('SQL SECRET'); } } }), e => !e.message.includes('SECRET'));
});
