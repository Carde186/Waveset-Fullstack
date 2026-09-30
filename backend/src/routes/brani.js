const express = require('express');

const pool = require('../config/database');
const { trovaLinkBranoApple } = require('../itunes/linkBrano');
const formattaBrano = require('../utilita/formattaBrano');

const router = express.Router();

// Il feed "Novità" della Home (prima /brani/recenti) è in routes/novita.js.

async function dettaglioBrano(req, res) {
    const { id } = req.params;

    const [righe] = await pool.query(
        `SELECT b.id, b.titolo, b.data_pubblicazione, b.url_spotify, b.collaboratori,
                a.id AS artista_id, a.nome AS artista_nome, a.immagine_url AS artista_immagine_url,
                al.id AS album_id, al.titolo AS album_titolo, al.copertina_url AS album_copertina_url
         FROM brano b
         INNER JOIN artista a ON a.id = b.artista_id
         LEFT JOIN album al ON al.id = b.album_id
         WHERE b.id = ?`,
        [id],
    );

    if (righe.length === 0) {
        res.status(404).json({ messaggio: 'Brano non trovato' });
        return;
    }

    res.json(formattaBrano(righe[0]));
}

// Link Apple Music ALLA TRACCIA (mai il link album — vedi
// src/itunes/linkBrano.js) per i (soli) brani reali con una mappatura
// verificata: id di traccia fissi, mai cercati per somiglianza del
// titolo in una tracklist live. Mappatura statica, nessuna chiamata
// Apple: non c'è nulla da "ritrovare".
async function linkApple(req, res) {
    const { id } = req.params;
    const link = await trovaLinkBranoApple(id);

    if (!link) {
        res.status(404).json({
            messaggio: 'Nessun link Apple Music associato a questo brano',
        });
        return;
    }

    res.json({ link_traccia: link });
}

router.get('/brani/:id', dettaglioBrano);
router.get('/brani/:id/link-apple', linkApple);

module.exports = router;
