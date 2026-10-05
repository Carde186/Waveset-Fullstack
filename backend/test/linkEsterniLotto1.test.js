// Link Spotify verificati: nessuna chiamata a provider esterni.
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, chiama, chiudi } = require('./aiuto');

let idAlbumCarlCox;
let idAlbumCharlotte;
let idAlbumDemo;

before(async () => {
    const [[carlCox]] = await db.query(
        `SELECT al.id FROM album al
         INNER JOIN artista ar ON ar.id = al.artista_id
         WHERE ar.nome = 'Carl Cox' LIMIT 1`,
    );
    idAlbumCarlCox = carlCox.id;

    const [[charlotte]] = await db.query(
        `SELECT al.id FROM album al
         INNER JOIN artista ar ON ar.id = al.artista_id
         WHERE ar.nome = 'Charlotte de Witte' LIMIT 1`,
    );
    idAlbumCharlotte = charlotte.id;

    const [[demoAlbum]] = await db.query(
        `SELECT al.id FROM album al
         INNER JOIN artista ar ON ar.id = al.artista_id
         WHERE ar.nome = 'Nova Circuit' LIMIT 1`,
    );
    idAlbumDemo = demoAlbum.id;


});

after(chiudi);

describe('link Spotify album (mai un link di un brano)', () => {
    test('Carl Cox: link album verificato', async () => {
        const { stato, dati } = await chiama(
            `/album/${idAlbumCarlCox}/link-spotify`,
        );
        assert.equal(stato, 200);
        assert.deepEqual(Object.keys(dati), ['link_store']);
        assert.equal(
            dati.link_store,
            'https://open.spotify.com/album/6p5qiYillRycbleqmPUR53',
        );
    });

    test('Charlotte de Witte: link album verificato', async () => {
        const { stato, dati } = await chiama(
            `/album/${idAlbumCharlotte}/link-spotify`,
        );
        assert.equal(stato, 200);
        assert.equal(
            dati.link_store,
            'https://open.spotify.com/album/7rdrIHvtAcAxbyMTC6fo9a',
        );
    });

    test('album demo: nessuna mappatura', async () => {
        const { stato } = await chiama(`/album/${idAlbumDemo}/link-spotify`);
        assert.equal(stato, 404);
    });
});

describe('mai un link Spotify fittizio', () => {
    test('nessun brano ha uno dei 4 url_spotify fittizi del seed dimostrativo', async () => {
        const URL_FITTIZI = [
            'https://open.spotify.com/track/0000000000000000000001',
            'https://open.spotify.com/track/0000000000000000000002',
            'https://open.spotify.com/track/0000000000000000000003',
            'https://open.spotify.com/track/0000000000000000000004',
        ];
        const [righe] = await db.query(
            'SELECT id, titolo, url_spotify FROM brano WHERE url_spotify IN (?)',
            [URL_FITTIZI],
        );
        assert.deepEqual(
            righe,
            [],
            'trovati url_spotify fittizi ancora nel database: ' +
                JSON.stringify(righe),
        );
    });
});
