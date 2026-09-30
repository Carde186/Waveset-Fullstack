// GET /api/admin/deezer/anteprima: protezione di ruolo, dati minimizzati,
// dati mancanti (album/brani) senza far fallire l'intera risposta, errori
// HTTP ed errori Deezer con status 200. Stesso schema di
// adminSpotify.test.js: app eseguita in-process (porta dedicata) per poter
// mockare src/servizi/deezer.js con mock.method — nessuna chiamata Deezer
// reale in questi test.
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3098/api';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { UTENTE_A, UTENTE_ADMIN, chiama, accedi, chiudi } = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const servizioDeezer = require('../src/servizi/deezer');

let server;
let admin;
let utenteA;

before(async () => {
    await new Promise((risolvi, rifiuta) => {
        server = creaApp().listen(3098, errore =>
            errore ? rifiuta(errore) : risolvi(),
        );
    });
    admin = await accedi(UTENTE_ADMIN);
    utenteA = await accedi(UTENTE_A);
});

after(async () => {
    await chiudi();
    await poolApp.end();
    await new Promise(risolvi => server.close(risolvi));
});

const ARTISTA_FITTIZIO = {
    name: 'Artista di prova',
    picture_medium: 'https://esempio.test/artista.jpg',
    link: 'https://www.deezer.com/artist/finto',
};

const ALBUM_FITTIZIO = {
    id: 111,
    title: 'Album di prova',
    cover_medium: 'https://esempio.test/album.jpg',
    link: 'https://www.deezer.com/album/finto',
};

const BRANI_FITTIZI = [
    {
        id: 222,
        title: 'Brano di prova',
        duration: 200,
        link: 'https://www.deezer.com/track/finto',
        preview:
            'https://cdnt-preview.dzcdn.net/api/1/firmato-non-deve-comparire',
    },
];

describe('protezione di ruolo', () => {
    test('senza sessione: 401', async () => {
        const { stato } = await chiama('/admin/deezer/anteprima');
        assert.equal(stato, 401);
    });

    test('utente non ADMIN: 403', async () => {
        const { stato } = await chiama('/admin/deezer/anteprima', {
            sessione: utenteA,
        });
        assert.equal(stato, 403);
    });
});

describe('anteprima', () => {
    test('successo: dati minimizzati, mai preview audio', async t => {
        t.mock.method(
            servizioDeezer,
            'ottieniArtista',
            async () => ARTISTA_FITTIZIO,
        );
        t.mock.method(
            servizioDeezer,
            'ottieniAlbum',
            async () => ALBUM_FITTIZIO,
        );
        t.mock.method(
            servizioDeezer,
            'ottieniBraniAlbum',
            async () => BRANI_FITTIZI,
        );

        const { stato, dati } = await chiama('/admin/deezer/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 200);
        assert.deepEqual(Object.keys(dati).sort(), [
            'album',
            'artista',
            'brani',
        ]);

        assert.deepEqual(Object.keys(dati.artista).sort(), [
            'foto_url',
            'nome',
            'url_deezer',
        ]);
        assert.equal(dati.artista.nome, 'Artista di prova');

        assert.deepEqual(Object.keys(dati.album).sort(), [
            'copertina_url',
            'id',
            'titolo',
            'url_deezer',
        ]);

        assert.equal(dati.brani.length, 1);
        assert.deepEqual(Object.keys(dati.brani[0]).sort(), [
            'durata_secondi',
            'id',
            'titolo',
            'url_deezer',
        ]);
        // Mai il campo preview, nemmeno per errore.
        assert.equal('preview' in dati.brani[0], false);
    });

    test('artista irraggiungibile: 502, risposta intera fallita', async t => {
        t.mock.method(servizioDeezer, 'ottieniArtista', async () => {
            throw new servizioDeezer.ErroreDeezer('offline', 'http', 500);
        });

        const { stato, dati } = await chiama('/admin/deezer/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 502);
        assert.equal(dati.messaggio, 'Deezer non raggiungibile');
    });

    test('corpo Deezer con "error" nonostante HTTP 200 sull\'artista: 502', async t => {
        t.mock.method(servizioDeezer, 'ottieniArtista', async () => {
            throw new servizioDeezer.ErroreDeezer(
                'Deezer: data not found (800)',
                'api',
                200,
                800,
            );
        });

        const { stato, dati } = await chiama('/admin/deezer/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 502);
        assert.equal(dati.messaggio, 'Deezer non raggiungibile');
    });

    test('album stesso assente (code 800 su ottieniAlbum): album null, brani vuoti', async t => {
        t.mock.method(
            servizioDeezer,
            'ottieniArtista',
            async () => ARTISTA_FITTIZIO,
        );
        t.mock.method(servizioDeezer, 'ottieniAlbum', async () => {
            throw new servizioDeezer.ErroreDeezer(
                'Deezer: data not found (800)',
                'api',
                200,
                800,
            );
        });
        t.mock.method(servizioDeezer, 'ottieniBraniAlbum', async () => {
            throw new servizioDeezer.ErroreDeezer(
                'Deezer: data not found (800)',
                'api',
                200,
                800,
            );
        });

        const { stato, dati } = await chiama('/admin/deezer/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 200);
        assert.equal(dati.artista.nome, 'Artista di prova');
        assert.equal(dati.album, null);
        assert.deepEqual(dati.brani, []);
    });

    test('album TROVATO ma tracklist assente (code 800 solo su ottieniBraniAlbum): album conservato, brani vuoti', async t => {
        t.mock.method(
            servizioDeezer,
            'ottieniArtista',
            async () => ARTISTA_FITTIZIO,
        );
        t.mock.method(
            servizioDeezer,
            'ottieniAlbum',
            async () => ALBUM_FITTIZIO,
        );
        t.mock.method(servizioDeezer, 'ottieniBraniAlbum', async () => {
            throw new servizioDeezer.ErroreDeezer(
                'Deezer: data not found (800)',
                'api',
                200,
                800,
            );
        });

        const { stato, dati } = await chiama('/admin/deezer/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 200);
        assert.equal(dati.artista.nome, 'Artista di prova');
        // L'album NON deve diventare null solo perché la tracklist manca:
        // sono due dati indipendenti.
        assert.notEqual(dati.album, null);
        assert.deepEqual(Object.keys(dati.album).sort(), [
            'copertina_url',
            'id',
            'titolo',
            'url_deezer',
        ]);
        assert.equal(dati.album.titolo, 'Album di prova');
        assert.deepEqual(dati.brani, []);
    });

    test("guasto vero sull'album (non 'not found'): l'intera risposta fallisce, non diventa un falso dato assente", async t => {
        t.mock.method(
            servizioDeezer,
            'ottieniArtista',
            async () => ARTISTA_FITTIZIO,
        );
        // Guasto di rete, non un "not found" Deezer: prima della
        // correzione, con Promise.all, questo produceva comunque 200 con
        // album:null — è esattamente il bug corretto qui.
        t.mock.method(servizioDeezer, 'ottieniAlbum', async () => {
            throw new servizioDeezer.ErroreDeezer('offline', 'http', 500);
        });
        t.mock.method(
            servizioDeezer,
            'ottieniBraniAlbum',
            async () => BRANI_FITTIZI,
        );

        const { stato, dati } = await chiama('/admin/deezer/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 502);
        assert.equal(dati.messaggio, 'Deezer non raggiungibile');
    });

    test('quota superata sui brani (code 4): 503, non un 200 mascherato', async t => {
        t.mock.method(
            servizioDeezer,
            'ottieniArtista',
            async () => ARTISTA_FITTIZIO,
        );
        t.mock.method(
            servizioDeezer,
            'ottieniAlbum',
            async () => ALBUM_FITTIZIO,
        );
        t.mock.method(servizioDeezer, 'ottieniBraniAlbum', async () => {
            throw new servizioDeezer.ErroreDeezer(
                'Deezer: quota (4)',
                'api',
                200,
                4,
            );
        });

        const { stato, dati } = await chiama('/admin/deezer/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 503);
        assert.equal(
            dati.messaggio,
            'Troppe richieste a Deezer, riprova più tardi',
        );
    });
});
