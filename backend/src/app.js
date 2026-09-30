const express = require('express');

const richiediAutenticazione = require('./autenticazione/richiediAutenticazione');
const richiediRuolo = require('./autenticazione/richiediRuolo');
const gestisciErrore = require('./gestisciErrore');
const routeAdminDeezer = require('./routes/admin/deezer');
const routeAdminEventi = require('./routes/admin/eventi');
const routeAdminSpotify = require('./routes/admin/spotify');
const routeAlbum = require('./routes/album');
const routeArtisti = require('./routes/artisti');
const routeAutenticazione = require('./routes/autenticazione');
const routeBrani = require('./routes/brani');
const routeDeezer = require('./routes/deezer');
const routeEventi = require('./routes/eventi');
const routeGeneri = require('./routes/generi');
const routeNovita = require('./routes/novita');
const routePlaylist = require('./routes/playlist');
const routeRicerca = require('./routes/ricerca');
const routeSalute = require('./routes/salute');

function creaApp() {
    const app = express();

    app.use(express.json());
    app.use(routeSalute);
    app.use('/api', routeGeneri);
    app.use('/api', routeArtisti);
    app.use('/api', routeBrani);
    app.use('/api', routeAlbum);
    app.use('/api', routeRicerca);
    app.use('/api', routeEventi);
    app.use('/api', routeNovita);
    app.use('/api/auth', routeAutenticazione);
    // Middleware montato solo su /api/playlist: su '/api' intercetterebbe
    // anche gli URL inesistenti del catalogo (401 al posto di 404).
    app.use('/api/playlist', richiediAutenticazione, routePlaylist);
    // Sezione "Scopri su Deezer" in Home: sola lettura, riservata a utenti
    // autenticati (non un requisito di ruolo ADMIN come le route sotto).
    app.use('/api/deezer', richiediAutenticazione, routeDeezer);
    // Prima route riservata al ruolo ADMIN del progetto (coda di revisione
    // Ticketmaster): protetta anche qui, non basta nascondere le schermate
    // lato app.
    app.use(
        '/api/admin/eventi',
        richiediAutenticazione,
        richiediRuolo('ADMIN'),
        routeAdminEventi,
    );
    // Anteprima Spotify di sola lettura (demo, non il seed del catalogo):
    // stesso doppio requisito autenticazione+ruolo, mai solo il controllo
    // lato app.
    app.use(
        '/api/admin/spotify',
        richiediAutenticazione,
        richiediRuolo('ADMIN'),
        routeAdminSpotify,
    );
    // Anteprima Deezer di sola lettura (demo, separata da quella Spotify):
    // stesso doppio requisito autenticazione+ruolo.
    app.use(
        '/api/admin/deezer',
        richiediAutenticazione,
        richiediRuolo('ADMIN'),
        routeAdminDeezer,
    );

    // Sempre per ultimo, dopo tutte le route.
    app.use(gestisciErrore);

    return app;
}

module.exports = creaApp;
