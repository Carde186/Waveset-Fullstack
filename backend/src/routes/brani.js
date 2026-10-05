const express = require('express');

const pool = require('../config/database');
const { immaginiArtisti } = require('../artistiProvider/immagini');
const formattaBrano = require('../utilita/formattaBrano');

const { artistaPubblico } = require('../catalogo/pubblico');
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
         WHERE b.id = ? AND ${artistaPubblico()}`,
        [id],
    );

    if (righe.length === 0) {
        res.status(404).json({ messaggio: 'Brano non trovato' });
        return;
    }

    const [brano] = await immaginiArtisti(righe, { campoId: 'artista_id', campoImmagine: 'artista_immagine_url' });
    res.json(formattaBrano(brano));
}

router.get('/brani/:id', dettaglioBrano);

module.exports = router;
