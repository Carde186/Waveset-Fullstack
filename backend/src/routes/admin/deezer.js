const express = require('express');

const { costruisciAnteprima } = require('../../deezer/anteprima');

const router = express.Router();

// Anteprima fissa (CLAUDE.md, "Integrazioni esterne" — Deezer): come quella
// Spotify, non è il seed del catalogo, solo una dimostrazione di sola
// lettura per l'ADMIN. Id verificati con una sonda reale prima di scrivere
// questo file. Stessi id della sezione "Scopri su Deezer" in Home (vedi
// routes/deezer.js): unica integrazione Deezer già supportata.
const ARTISTA_ID = '3951'; // Carl Cox
const ALBUM_ID = '905333022'; // Electronic Generations
const LIMITE_BRANI = 5;

async function anteprima(req, res) {
    const risultato = await costruisciAnteprima(
        ARTISTA_ID,
        ALBUM_ID,
        LIMITE_BRANI,
    );

    if (!risultato.ok) {
        res.status(risultato.stato).json({ messaggio: risultato.messaggio });
        return;
    }

    res.json(risultato.dati);
}

router.get('/anteprima', anteprima);

module.exports = router;
