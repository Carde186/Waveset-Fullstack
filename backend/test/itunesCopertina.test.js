// GET /api/album/:id/copertina-itunes — mappatura per chiave naturale
// (nome artista + titolo album, mai id locale hardcoded), match verificato
// (non solo l'id salvato), fallback su qualunque anomalia. Stesso schema di
// adminDeezer.test.js: app eseguita in-process su una porta dedicata per
// poter mockare src/servizi/itunes.js con mock.method — nessuna chiamata
// Apple reale in questi test.
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3096/api';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, chiama, chiudi } = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const servizioItunes = require('../src/servizi/itunes');
const { trovaVoceMappatura } = require('../src/itunes/copertina');

let server;
let idAlbumCarlCox;
let idAlbumCharlotte;
let idAlbumDemo;

const DATI_CARL_COX = {
    collectionId: 524442022,
    artistName: 'Carl Cox',
    collectionName: 'All Roads Lead to the Dancefloor',
    artworkUrl100:
        'https://is1-ssl.mzstatic.com/image/thumb/carlcox/100x100bb.jpg',
    collectionViewUrl:
        'https://music.apple.com/it/album/all-roads-lead-to-the-dancefloor/524442022',
};

const DATI_CHARLOTTE = {
    collectionId: 1835870523,
    artistName: 'Charlotte de Witte',
    collectionName: 'Charlotte de Witte',
    artworkUrl100:
        'https://is1-ssl.mzstatic.com/image/thumb/charlotte/100x100bb.jpg',
    collectionViewUrl:
        'https://music.apple.com/it/album/charlotte-de-witte/1835870523',
};

before(async () => {
    await new Promise((risolvi, rifiuta) => {
        server = creaApp().listen(3096, errore =>
            errore ? rifiuta(errore) : risolvi(),
        );
    });

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

    const [[demo]] = await db.query(
        `SELECT al.id FROM album al
         INNER JOIN artista ar ON ar.id = al.artista_id
         WHERE ar.nome = 'Nova Circuit' LIMIT 1`,
    );
    idAlbumDemo = demo.id;
});

after(async () => {
    await chiudi();
    await poolApp.end();
    await new Promise(risolvi => server.close(risolvi));
});

describe('due match corretti', () => {
    test('Carl Cox: artwork e link della release giusta', async t => {
        t.mock.method(servizioItunes, 'ottieniAlbum', async id => {
            assert.equal(id, 524442022);
            return DATI_CARL_COX;
        });

        const { stato, dati } = await chiama(
            `/album/${idAlbumCarlCox}/copertina-itunes`,
        );

        assert.equal(stato, 200);
        assert.deepEqual(Object.keys(dati).sort(), [
            'artwork_url',
            'link_store',
        ]);
        assert.equal(dati.artwork_url, DATI_CARL_COX.artworkUrl100);
        assert.equal(dati.link_store, DATI_CARL_COX.collectionViewUrl);
    });

    test('Charlotte de Witte: artwork e link della release giusta', async t => {
        t.mock.method(servizioItunes, 'ottieniAlbum', async id => {
            assert.equal(id, 1835870523);
            return DATI_CHARLOTTE;
        });

        const { stato, dati } = await chiama(
            `/album/${idAlbumCharlotte}/copertina-itunes`,
        );

        assert.equal(stato, 200);
        assert.equal(dati.artwork_url, DATI_CHARLOTTE.artworkUrl100);
        assert.equal(dati.link_store, DATI_CHARLOTTE.collectionViewUrl);
    });
});

describe('album demo: nessuna mappatura', () => {
    test('un album del seed dimostrativo non viene mai interrogato su iTunes', async t => {
        const ottieniAlbum = t.mock.method(
            servizioItunes,
            'ottieniAlbum',
            async () => {
                throw new Error('non doveva essere chiamato per un album demo');
            },
        );

        const { stato, dati } = await chiama(
            `/album/${idAlbumDemo}/copertina-itunes`,
        );

        assert.equal(stato, 404);
        assert.equal(
            dati.messaggio,
            'Nessuna copertina Apple associata a questo album',
        );
        assert.equal(ottieniAlbum.mock.calls.length, 0);
    });
});

describe('brani: ereditano la mappatura del proprio album, non di un altro', () => {
    test('un brano di Carl Cox risolve il collectionId di Carl Cox', async () => {
        const [[brano]] = await db.query(
            `SELECT b.album_id FROM brano b
             INNER JOIN artista ar ON ar.id = b.artista_id
             WHERE ar.nome = 'Carl Cox' LIMIT 1`,
        );

        const voce = await trovaVoceMappatura(brano.album_id);

        assert.ok(voce);
        assert.equal(voce.collectionIdApple, 524442022);
    });

    test('un brano di Charlotte de Witte risolve il collectionId di Charlotte de Witte, non quello di Carl Cox', async () => {
        const [[brano]] = await db.query(
            `SELECT b.album_id FROM brano b
             INNER JOIN artista ar ON ar.id = b.artista_id
             WHERE ar.nome = 'Charlotte de Witte' LIMIT 1`,
        );

        const voce = await trovaVoceMappatura(brano.album_id);

        assert.ok(voce);
        assert.equal(voce.collectionIdApple, 1835870523);
    });

    test('un brano del seed dimostrativo non risolve nessuna mappatura', async () => {
        const [[brano]] = await db.query(
            `SELECT b.album_id FROM brano b
             INNER JOIN artista ar ON ar.id = b.artista_id
             WHERE ar.nome = 'Nova Circuit' LIMIT 1`,
        );

        const voce = await trovaVoceMappatura(brano.album_id);

        assert.equal(voce, null);
    });
});

describe('risposta Apple assente o errore: fallback, mai un 200 mascherato', () => {
    test('iTunes irraggiungibile: 502', async t => {
        t.mock.method(servizioItunes, 'ottieniAlbum', async () => {
            throw new servizioItunes.ErroreItunes('offline', 500);
        });

        const { stato, dati } = await chiama(
            `/album/${idAlbumCarlCox}/copertina-itunes`,
        );

        assert.equal(stato, 502);
        assert.equal(dati.messaggio, 'iTunes non raggiungibile');
    });

    test('iTunes non restituisce risultati per l’id salvato: 404', async t => {
        t.mock.method(servizioItunes, 'ottieniAlbum', async () => null);

        const { stato, dati } = await chiama(
            `/album/${idAlbumCarlCox}/copertina-itunes`,
        );

        assert.equal(stato, 404);
        assert.equal(dati.messaggio, "L'album non è più disponibile su iTunes");
    });

    test('match non più valido (nome/titolo diversi da quelli salvati): 404, non mostrato comunque', async t => {
        t.mock.method(servizioItunes, 'ottieniAlbum', async () => ({
            artistName: 'Un Artista Diverso',
            collectionName: 'Un Album Diverso',
            artworkUrl100: 'https://esempio.test/artwork.jpg',
            collectionViewUrl: 'https://esempio.test/album',
        }));

        const { stato, dati } = await chiama(
            `/album/${idAlbumCarlCox}/copertina-itunes`,
        );

        assert.equal(stato, 404);
        assert.equal(dati.messaggio, 'Il match salvato non è più valido');
    });
});

describe('mai artwork senza link store, o viceversa', () => {
    test('manca il link store nella risposta Apple: 404, non un artwork isolato', async t => {
        t.mock.method(servizioItunes, 'ottieniAlbum', async () => ({
            ...DATI_CARL_COX,
            collectionViewUrl: null,
        }));

        const { stato, dati } = await chiama(
            `/album/${idAlbumCarlCox}/copertina-itunes`,
        );

        assert.equal(stato, 404);
        assert.equal(
            dati.messaggio,
            'Dati incompleti da iTunes per questo album',
        );
    });

    test('manca l’artwork nella risposta Apple: 404, non un link isolato', async t => {
        t.mock.method(servizioItunes, 'ottieniAlbum', async () => ({
            ...DATI_CARL_COX,
            artworkUrl100: null,
        }));

        const { stato, dati } = await chiama(
            `/album/${idAlbumCarlCox}/copertina-itunes`,
        );

        assert.equal(stato, 404);
        assert.equal(
            dati.messaggio,
            'Dati incompleti da iTunes per questo album',
        );
    });
});
