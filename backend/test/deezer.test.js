// GET /api/deezer/scopri: sezione "Scopri su Deezer" in Home, riservata a
// utenti autenticati (nessun requisito di ruolo, a differenza di
// adminDeezer.test.js). Stesso schema: app eseguita in-process su una porta
// dedicata per poter mockare src/servizi/deezer.js con mock.method —
// nessuna chiamata Deezer reale in questi test.
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3097/api';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { UTENTE_A, chiama, accedi, chiudi } = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const servizioDeezer = require('../src/servizi/deezer');

let server;
let utenteA;

before(async () => {
    await new Promise((risolvi, rifiuta) => {
        server = creaApp().listen(3097, errore =>
            errore ? rifiuta(errore) : risolvi(),
        );
    });
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
    { id: 1, title: 'Brano 1', duration: 200, link: 'https://deezer.test/1' },
    { id: 2, title: 'Brano 2', duration: 180, link: 'https://deezer.test/2' },
    { id: 3, title: 'Brano 3', duration: 220, link: 'https://deezer.test/3' },
    { id: 4, title: 'Brano 4', duration: 150, link: 'https://deezer.test/4' },
];

describe('protezione di autenticazione', () => {
    test('senza sessione: 401', async () => {
        const { stato } = await chiama('/deezer/scopri');
        assert.equal(stato, 401);
    });
});

describe('scopri', () => {
    test('successo: dati minimizzati, niente campi immagine, massimo 3 brani', async t => {
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

        const { stato, dati } = await chiama('/deezer/scopri', {
            sessione: utenteA,
        });

        assert.equal(stato, 200);
        assert.deepEqual(Object.keys(dati).sort(), [
            'album',
            'artista',
            'brani',
        ]);

        // Niente foto_url/copertina_url: la sezione Home è testo e link,
        // mai immagini (vedi routes/deezer.js).
        assert.deepEqual(Object.keys(dati.artista).sort(), [
            'nome',
            'url_deezer',
        ]);
        assert.deepEqual(Object.keys(dati.album).sort(), [
            'titolo',
            'url_deezer',
        ]);

        assert.equal(dati.brani.length, 3);
        assert.deepEqual(Object.keys(dati.brani[0]).sort(), [
            'durata_secondi',
            'id',
            'titolo',
            'url_deezer',
        ]);
    });

    test('album assente (code 800): album null, brani vuoti, 200', async t => {
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

        const { stato, dati } = await chiama('/deezer/scopri', {
            sessione: utenteA,
        });

        assert.equal(stato, 200);
        assert.equal(dati.album, null);
        assert.deepEqual(dati.brani, []);
    });

    test('guasto vero (non "not found"): 502, non un 200 mascherato', async t => {
        t.mock.method(servizioDeezer, 'ottieniArtista', async () => {
            throw new servizioDeezer.ErroreDeezer('offline', 'http', 500);
        });

        const { stato, dati } = await chiama('/deezer/scopri', {
            sessione: utenteA,
        });

        assert.equal(stato, 502);
        assert.equal(dati.messaggio, 'Deezer non raggiungibile');
    });

    test('quota superata (code 4): 503', async t => {
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

        const { stato, dati } = await chiama('/deezer/scopri', {
            sessione: utenteA,
        });

        assert.equal(stato, 503);
        assert.equal(
            dati.messaggio,
            'Troppe richieste a Deezer, riprova più tardi',
        );
    });
});
