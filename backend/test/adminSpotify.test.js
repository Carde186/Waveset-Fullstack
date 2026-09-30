// GET /api/admin/spotify/anteprima: protezione di ruolo, dati minimizzati,
// configurazione assente, rate limit ed errori generici. A differenza degli
// altri file di test qui l'app gira IN-PROCESS (porta dedicata, non quella
// di Docker) invece che tramite il container: serve per poter sostituire
// src/servizi/spotify.js con mock.method (node:test), così i test non fanno
// mai una chiamata di rete vera a Spotify e non richiedono le chiavi reali.
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3099/api';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { UTENTE_A, UTENTE_ADMIN, chiama, accedi, chiudi } = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const servizioSpotify = require('../src/servizi/spotify');

let server;
let admin;
let utenteA;

before(async () => {
    await new Promise((risolvi, rifiuta) => {
        server = creaApp().listen(3099, errore =>
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
    images: [{ url: 'https://esempio.test/artista.jpg' }],
    external_urls: { spotify: 'https://open.spotify.com/artist/finto' },
};

const RELEASE_FITTIZIE = {
    items: [
        {
            id: 'album-1',
            name: 'Album di prova',
            album_type: 'album',
            release_date: '2024-01-01',
            total_tracks: 10,
            images: [{ url: 'https://esempio.test/album.jpg' }],
            external_urls: { spotify: 'https://open.spotify.com/album/finto' },
        },
    ],
    total: 42,
    next: 'https://api.spotify.com/v1/artists/x/albums?offset=5',
};

const BRANI_FITTIZI = {
    items: [
        {
            id: 'brano-1',
            name: 'Brano di prova',
            track_number: 1,
            duration_ms: 200000,
            external_urls: { spotify: 'https://open.spotify.com/track/finto' },
        },
    ],
    total: 12,
    next: null,
};

describe('protezione di ruolo', () => {
    test('senza sessione: 401', async () => {
        const { stato } = await chiama('/admin/spotify/anteprima');
        assert.equal(stato, 401);
    });

    test('utente non ADMIN: 403', async () => {
        const { stato } = await chiama('/admin/spotify/anteprima', {
            sessione: utenteA,
        });
        assert.equal(stato, 403);
    });
});

// La route risponde 503 se SPOTIFY_CLIENT_ID/SECRET sono vuoti, anche quando i
// servizi sono mockati: ogni test dichiara da sé lo stato che gli serve, senza
// dipendere dall'ambiente né dall'ordine degli altri test.
//
// Salva lo stato iniziale delle due variabili e registra il ripristino con
// t.after, che gira anche se il test fallisce: una variabile prima assente
// resta assente (delete), una presente torna esattamente com'era.
function salvaCredenzialiSpotify(t) {
    const precedenti = {
        SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
        SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    };

    t.after(() => {
        for (const [nome, valore] of Object.entries(precedenti)) {
            if (valore === undefined) {
                delete process.env[nome];
            } else {
                process.env[nome] = valore;
            }
        }
    });
}

// Valori fittizi e locali, solo per superare il controllo di configurazione
// della route: nessuna credenziale reale, nessuna chiamata a Spotify.
function impostaCredenzialiSpotifyFittizie(t) {
    salvaCredenzialiSpotify(t);
    process.env.SPOTIFY_CLIENT_ID = 'id-fittizio-locale';
    process.env.SPOTIFY_CLIENT_SECRET = 'secret-fittizio-locale';
}

describe('anteprima', () => {
    test('successo: dati minimizzati da artista, release e brani', async t => {
        impostaCredenzialiSpotifyFittizie(t);
        t.mock.method(
            servizioSpotify,
            'ottieniToken',
            async () => 'token-fittizio',
        );
        t.mock.method(
            servizioSpotify,
            'ottieniArtista',
            async () => ARTISTA_FITTIZIO,
        );
        t.mock.method(
            servizioSpotify,
            'ottieniAlbumArtista',
            async () => RELEASE_FITTIZIE,
        );
        t.mock.method(
            servizioSpotify,
            'ottieniBraniAlbum',
            async () => BRANI_FITTIZI,
        );

        const { stato, dati } = await chiama('/admin/spotify/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 200);
        assert.deepEqual(Object.keys(dati).sort(), [
            'artista',
            'brani',
            'release',
        ]);

        assert.deepEqual(Object.keys(dati.artista).sort(), [
            'immagine_url',
            'nome',
            'url_spotify',
        ]);
        assert.equal(dati.artista.nome, 'Artista di prova');

        assert.equal(dati.release.length, 1);
        assert.deepEqual(Object.keys(dati.release[0]).sort(), [
            'copertina_url',
            'data_pubblicazione',
            'id',
            'nome',
            'numero_brani',
            'tipo',
            'url_spotify',
        ]);

        assert.equal(dati.brani.length, 1);
        assert.deepEqual(Object.keys(dati.brani[0]).sort(), [
            'durata_ms',
            'id',
            'numero_traccia',
            'titolo',
            'url_spotify',
        ]);
    });

    test("SPOTIFY_CLIENT_ID/SECRET assenti: 503, resto dell'app non toccato", async t => {
        salvaCredenzialiSpotify(t);
        delete process.env.SPOTIFY_CLIENT_ID;
        delete process.env.SPOTIFY_CLIENT_SECRET;

        const { stato, dati } = await chiama('/admin/spotify/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 503);
        assert.equal(dati.messaggio, 'Anteprima Spotify non configurata');
    });

    test('rate limit (429 da Spotify): 503, nessun dettaglio esposto', async t => {
        impostaCredenzialiSpotifyFittizie(t);
        t.mock.method(servizioSpotify, 'ottieniToken', async () => {
            throw new servizioSpotify.ErroreSpotify('limite superato', 429);
        });

        const { stato, dati } = await chiama('/admin/spotify/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 503);
        assert.equal(
            dati.messaggio,
            'Troppe richieste a Spotify, riprova più tardi',
        );
    });

    test('errore generico Spotify: 502, messaggio generico', async t => {
        impostaCredenzialiSpotifyFittizie(t);
        t.mock.method(
            servizioSpotify,
            'ottieniToken',
            async () => 'token-fittizio',
        );
        t.mock.method(servizioSpotify, 'ottieniArtista', async () => {
            throw new servizioSpotify.ErroreSpotify('non trovato', 404);
        });

        const { stato, dati } = await chiama('/admin/spotify/anteprima', {
            sessione: admin,
        });

        assert.equal(stato, 502);
        assert.equal(dati.messaggio, 'Spotify non raggiungibile');
    });
});
