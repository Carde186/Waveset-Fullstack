const express = require('express');

const richiediAutenticazione = require('./autenticazione/richiediAutenticazione');
const richiediRuolo = require('./autenticazione/richiediRuolo');
const { configurazioneWebDaAmbiente } = require('./autenticazione/configurazioneWeb');
const {
    configurazioneLoginDaAmbiente,
    creaLimiteLogin,
} = require('./autenticazione/limiteLogin');
const {
    configurazioneRegistrazioneDaAmbiente,
    creaLimitatore,
    limitaRichieste,
} = require('./autenticazione/limiteRichieste');
const { proteggiSessioneCookie } = require('./autenticazione/proteggiSessioneCookie');
const gestisciErrore = require('./gestisciErrore');
const routeAdminDeezer = require('./routes/admin/deezer');
const routeAdminEventi = require('./routes/admin/eventi');
const { creaRouteAdminArtisti } = require('./routes/admin/artisti');
const routeAdminSpotify = require('./routes/admin/spotify');
const routeAlbum = require('./routes/album');
const routeArtisti = require('./routes/artisti');
const routeAutenticazione = require('./routes/autenticazione');
const routeAccount = require('./routes/account');
const routeBrani = require('./routes/brani');
const routeDeezer = require('./routes/deezer');
const routeEventi = require('./routes/eventi');
const routeGeneri = require('./routes/generi');
const routeNovita = require('./routes/novita');
const routePlaylist = require('./routes/playlist');
const routeRicerca = require('./routes/ricerca');
const routeSalute = require('./routes/salute');
const { creaRoute: creaRouteDiscografia } = require('./routes/discografia');

// Le opzioni servono SOLO ai test (soglie basse, orologio controllato, IP
// simulato) e sono parametri di codice: non arrivano mai da HTTP né dall'ambiente.
// - `limitatoreRegistrazione`: senza, si crea dai valori normali (30 richieste
//   per IP ogni 15 minuti).
// - `limitiLogin`: senza, si creano dai valori normali (10 fallimenti per
//   IP+email, 50 fallimenti e 100 tentativi totali per IP ogni 15 minuti).
// - `ricavaIp`: senza, è l'indirizzo del socket (`req.ip`).
// - `configurazioneWeb`: senza, si legge dall'ambiente (FRONTEND_ORIGINS,
//   COOKIE_SECURE). Senza una configurazione valida la sessione browser è
//   DISABILITATA: il cookie non autentica nessuno e il bearer non cambia.
// Tutte le soglie normali si cambiano con variabili d'ambiente.
function creaApp(opzioni = {}) {
    const app = express();

    // Volutamente disattivato: req.ip è l'indirizzo del socket e
    // X-Forwarded-For viene ignorato (nessun IP falsificabile dal client).
    app.set('trust proxy', false);

    let limitatoreRegistrazione = opzioni.limitatoreRegistrazione;

    if (!limitatoreRegistrazione) {
        limitatoreRegistrazione = creaLimitatore(
            configurazioneRegistrazioneDaAmbiente(),
        );
        limitatoreRegistrazione.avviaPulizia();
    }

    let limitiLogin = opzioni.limitiLogin;

    if (!limitiLogin) {
        limitiLogin = creaLimiteLogin(configurazioneLoginDaAmbiente());
        limitiLogin.avviaPulizia();
    }

    // Letti dal gestore del login (routes/autenticazione.js).
    app.locals.limitiLogin = limitiLogin;
    app.locals.limitiAccount = opzioni.limitatoreAccount ?? creaLimitatore({ massimo: 20, finestraMs: 900_000 });
    if (!opzioni.limitatoreAccount) app.locals.limitiAccount.avviaPulizia();
    app.locals.ricavaIp = opzioni.ricavaIp ?? (req => req.ip);

    // Letta da trovaSessione (trasporto cookie) e da proteggiSessioneCookie.
    let configurazioneWeb = opzioni.configurazioneWeb;

    if (!configurazioneWeb) {
        configurazioneWeb = configurazioneWebDaAmbiente();

        // Web non richiesto (nessuna FRONTEND_ORIGINS): nessun rumore. Un valore
        // presente ma non valido si segnala, senza fermare il backend.
        if (
            !configurazioneWeb.abilitata &&
            !(
                configurazioneWeb.motivi.length === 1 &&
                configurazioneWeb.motivi[0] === 'FRONTEND_ORIGINS non impostata'
            )
        ) {
            console.warn(
                `Sessione browser DISABILITATA (il login bearer non cambia): ${configurazioneWeb.motivi.join('; ')}`,
            );
        }
    }

    app.locals.configurazioneWeb = configurazioneWeb;

    // Per prima su /api, prima del limitatore e del corpo: una richiesta con il
    // cookie di sessione che non supera Origin e CSRF riceve 403 senza
    // consumare quote né arrivare a nessuna route.
    app.use('/api', proteggiSessioneCookie);

    // Prima di express.json(): una richiesta bloccata non paga il parsing del
    // corpo, la validazione né bcrypt. Conta successi e fallimenti.
    app.post('/api/auth/registrazione', limitaRichieste(limitatoreRegistrazione));

    app.use(express.json());
    app.use(routeSalute);
    app.use('/api', routeGeneri);
    app.use('/api', creaRouteDiscografia(opzioni.discografia));
    app.use('/api', routeArtisti);
    app.use('/api', routeBrani);
    app.use('/api', routeAlbum);
    app.use('/api', routeRicerca);
    app.use('/api', routeEventi);
    app.use('/api', routeNovita);
    app.use('/api/auth', routeAutenticazione);
    app.use('/api/auth', routeAccount);
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
    app.use('/api/admin/artisti', richiediAutenticazione, richiediRuolo('ADMIN'),
        creaRouteAdminArtisti(opzioni.appleMusicService, opzioni.artistiProvider));
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
