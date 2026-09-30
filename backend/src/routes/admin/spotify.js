const express = require('express');

const servizioSpotify = require('../../servizi/spotify');

const router = express.Router();

// Anteprima fissa (CLAUDE.md, "Integrazioni esterne" — Spotify): non è il
// seed del catalogo, solo una dimostrazione di sola lettura per l'ADMIN.
// Artista e album scelti a mano, non parametrici: restano questi finché non
// esiste un vero import.
const ARTISTA_ID = '19SmlbABtI4bXz864MLqOS'; // Carl Cox
const ALBUM_ID = '15XrNU8AkmvwmGkoi6sLSs'; // Electronic Generations
const LIMITE_RELEASE = 5;
const LIMITE_BRANI = 10;
const MARKET = 'IT';

async function anteprima(req, res) {
    // Il resto dell'app deve continuare a funzionare senza questa chiave:
    // 503 controllato, non un 500 che sembri un bug del codice.
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        res.status(503).json({
            messaggio: 'Anteprima Spotify non configurata',
        });
        return;
    }

    try {
        const token = await servizioSpotify.ottieniToken();

        const [artista, release, brani] = await Promise.all([
            servizioSpotify.ottieniArtista(ARTISTA_ID, token),
            servizioSpotify.ottieniAlbumArtista(ARTISTA_ID, token, {
                limit: LIMITE_RELEASE,
                market: MARKET,
            }),
            servizioSpotify.ottieniBraniAlbum(ALBUM_ID, token, {
                limit: LIMITE_BRANI,
                market: MARKET,
            }),
        ]);

        // Dati minimizzati: solo i campi che la schermata mostra davvero,
        // mai l'oggetto Spotify completo (niente popularity/followers/href
        // e simili, non servono e non vanno esposti senza motivo).
        res.json({
            artista: {
                nome: artista.name,
                immagine_url: artista.images?.[0]?.url ?? null,
                url_spotify: artista.external_urls?.spotify ?? null,
            },
            release: release.items.map(r => ({
                id: r.id,
                nome: r.name,
                tipo: r.album_type,
                data_pubblicazione: r.release_date,
                numero_brani: r.total_tracks,
                copertina_url: r.images?.[0]?.url ?? null,
                url_spotify: r.external_urls?.spotify ?? null,
            })),
            brani: brani.items.map(t => ({
                id: t.id,
                titolo: t.name,
                numero_traccia: t.track_number,
                durata_ms: t.duration_ms,
                url_spotify: t.external_urls?.spotify ?? null,
            })),
        });
    } catch (errore) {
        // Mai il messaggio grezzo dell'errore nella risposta (potrebbe
        // comunque finire nei log lato client): solo una distinzione tra
        // "troppe richieste" e "non raggiungibile", niente di più.
        if (
            errore instanceof servizioSpotify.ErroreSpotify &&
            errore.stato === 429
        ) {
            res.status(503).json({
                messaggio: 'Troppe richieste a Spotify, riprova più tardi',
            });
            return;
        }
        res.status(502).json({ messaggio: 'Spotify non raggiungibile' });
    }
}

router.get('/anteprima', anteprima);

module.exports = router;
