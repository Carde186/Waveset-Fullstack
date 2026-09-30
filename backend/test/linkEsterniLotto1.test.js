// GET /api/album/:id/link-spotify e GET /api/brani/:id/link-apple —
// mappature statiche (nessuna chiamata esterna, vedi src/spotify/
// linkAlbum.js e src/itunes/linkBrano.js), quindi contro il backend già in
// esecuzione (nessun mock necessario, a differenza di itunesCopertina.
// test.js che chiama davvero Apple per l'artwork).
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, chiama, chiudi } = require('./aiuto');

let idAlbumCarlCox;
let idAlbumCharlotte;
let idAlbumDemo;
let idBranoCarlCoxShortBlack;
let idBranoCarlCoxBreadButter;
let idBranoCharlotteRealm;
let idBranoDemo;

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

    // Titoli tolleranti: funzionano sia prima sia dopo
    // scripts/correggiLotto1.js (vedi src/itunes/linkBrano.js).
    const [[shortBlack]] = await db.query(
        `SELECT b.id FROM brano b
         INNER JOIN artista ar ON ar.id = b.artista_id
         WHERE ar.nome = 'Carl Cox' AND b.titolo LIKE 'Short Black%' LIMIT 1`,
    );
    idBranoCarlCoxShortBlack = shortBlack.id;

    const [[breadButter]] = await db.query(
        `SELECT b.id FROM brano b
         INNER JOIN artista ar ON ar.id = b.artista_id
         WHERE ar.nome = 'Carl Cox' AND b.titolo = 'Bread & Butter' LIMIT 1`,
    );
    idBranoCarlCoxBreadButter = breadButter.id;

    const [[realm]] = await db.query(
        `SELECT b.id FROM brano b
         INNER JOIN artista ar ON ar.id = b.artista_id
         WHERE ar.nome = 'Charlotte de Witte' AND b.titolo = 'The Realm' LIMIT 1`,
    );
    idBranoCharlotteRealm = realm.id;

    const [[demoBrano]] = await db.query(
        `SELECT b.id FROM brano b
         INNER JOIN artista ar ON ar.id = b.artista_id
         WHERE ar.nome = 'Nova Circuit' LIMIT 1`,
    );
    idBranoDemo = demoBrano.id;
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

describe('link Apple Music traccia (mai un link album)', () => {
    test('Short Black (Carl Cox): link traccia con ?i=, non il link album', async () => {
        const { stato, dati } = await chiama(
            `/brani/${idBranoCarlCoxShortBlack}/link-apple`,
        );
        assert.equal(stato, 200);
        assert.deepEqual(Object.keys(dati), ['link_traccia']);
        assert.ok(dati.link_traccia.includes('?i=524443471'));
        assert.notEqual(
            dati.link_traccia,
            'https://music.apple.com/it/album/all-roads-lead-to-the-dancefloor/524442022?uo=4',
        );
    });

    test('Bread & Butter (Carl Cox): link traccia corretto', async () => {
        const { stato, dati } = await chiama(
            `/brani/${idBranoCarlCoxBreadButter}/link-apple`,
        );
        assert.equal(stato, 200);
        assert.ok(dati.link_traccia.includes('?i=524443475'));
    });

    test('The Realm (Charlotte de Witte): link traccia corretto, non quello di Carl Cox', async () => {
        const { stato, dati } = await chiama(
            `/brani/${idBranoCharlotteRealm}/link-apple`,
        );
        assert.equal(stato, 200);
        assert.ok(dati.link_traccia.includes('1835870523'));
        assert.ok(dati.link_traccia.includes('?i=1835870525'));
    });

    test('brano demo: nessuna mappatura', async () => {
        const { stato } = await chiama(`/brani/${idBranoDemo}/link-apple`);
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
