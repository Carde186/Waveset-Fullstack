const express = require('express');

const { costruisciAnteprima } = require('../deezer/anteprima');

const router = express.Router();

// Sezione "Scopri su Deezer" in Home (solo utenti autenticati, vedi
// app.js): stessa demo fissa già mostrata all'ADMIN in Anteprima Deezer
// (unica integrazione Deezer già supportata) — non un proxy generico verso
// Deezer, nessun id accettato da query/params. Set più piccolo (3 brani
// invece di 5): è un widget compatto in Home, non la schermata di
// dimostrazione ADMIN.
const ARTISTA_ID = '3951'; // Carl Cox
const ALBUM_ID = '905333022'; // Electronic Generations
const LIMITE_BRANI = 3;

async function scopri(req, res) {
    const risultato = await costruisciAnteprima(
        ARTISTA_ID,
        ALBUM_ID,
        LIMITE_BRANI,
    );

    if (!risultato.ok) {
        res.status(risultato.stato).json({ messaggio: risultato.messaggio });
        return;
    }

    // Niente immagini in questa risposta: Deezer vieta di conservare le
    // copertine/foto (FAQ Deezer — vedi CLAUDE.md, "Integrazioni esterne"),
    // e <Image> di React Native su Android le cachea comunque da solo
    // (Fresco), fuori dal nostro controllo. L'anteprima ADMIN (schermata a
    // sé, non in Home) resta com'era; qui i campi immagine non vengono
    // proprio inviati, così il client non può mostrarli nemmeno per
    // errore.
    const { artista, album, brani } = risultato.dati;
    res.json({
        artista: {
            nome: artista.nome,
            url_deezer: artista.url_deezer,
        },
        album: album
            ? { titolo: album.titolo, url_deezer: album.url_deezer }
            : null,
        brani: brani.map(b => ({
            id: b.id,
            titolo: b.titolo,
            durata_secondi: b.durata_secondi,
            url_deezer: b.url_deezer,
        })),
    });
}

router.get('/scopri', scopri);

module.exports = router;
