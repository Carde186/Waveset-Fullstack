const express = require('express');

const { ottieniCopertina } = require('../itunes/copertina');
const pool = require('../config/database');
const { trovaLinkAlbumSpotify } = require('../spotify/linkAlbum');

const router = express.Router();

async function dettaglioAlbum(req, res) {
    const { id } = req.params;

    const [righeAlbum] = await pool.query(
        `SELECT al.id, al.titolo, al.data_pubblicazione, al.copertina_url,
                a.id AS artista_id, a.nome AS artista_nome, a.immagine_url AS artista_immagine_url
         FROM album al
         INNER JOIN artista a ON a.id = al.artista_id
         WHERE al.id = ?`,
        [id],
    );

    if (righeAlbum.length === 0) {
        res.status(404).json({ messaggio: 'Album non trovato' });
        return;
    }

    const [brani] = await pool.query(
        `SELECT id, titolo, data_pubblicazione, url_spotify
         FROM brano
         WHERE album_id = ?
         ORDER BY data_pubblicazione ASC`,
        [id],
    );

    const album = righeAlbum[0];

    res.json({
        id: album.id,
        titolo: album.titolo,
        dataPubblicazione: album.data_pubblicazione,
        copertinaUrl: album.copertina_url,
        artista: {
            id: album.artista_id,
            nome: album.artista_nome,
            immagineUrl: album.artista_immagine_url,
        },
        brani,
    });
}

// Copertina live da iTunes per i (soli) album reali con una mappatura
// verificata (vedi src/itunes/copertina.js) — mai scritta nel database, mai
// un proxy generico: il client passa solo un id album locale già
// esistente, l'id Apple da interrogare lo decide sempre e solo questa
// mappatura lato server. 404 per qualunque motivo (nessuna mappatura,
// match non più valido) o 502 (iTunes irraggiungibile): il frontend deve
// trattarli allo stesso modo, restando sul fallback esistente.
async function copertinaItunes(req, res) {
    const { id } = req.params;
    const risultato = await ottieniCopertina(id);

    if (!risultato.ok) {
        res.status(risultato.stato).json({ messaggio: risultato.motivo });
        return;
    }

    res.json(risultato.dati);
}

// Link Spotify ALL'ALBUM (mai un link di un brano) per i (soli) album
// reali con una mappatura verificata (vedi src/spotify/linkAlbum.js) —
// mappatura statica, nessuna chiamata Spotify: non c'è nulla da
// "ritrovare", solo da restituire. Stesso principio di scoping di
// copertinaItunes sopra: il client passa solo un id album locale già
// esistente.
async function linkSpotify(req, res) {
    const { id } = req.params;
    const link = await trovaLinkAlbumSpotify(id);

    if (!link) {
        res.status(404).json({
            messaggio: 'Nessun link Spotify associato a questo album',
        });
        return;
    }

    res.json({ link_store: link });
}

router.get('/album/:id', dettaglioAlbum);
router.get('/album/:id/copertina-itunes', copertinaItunes);
router.get('/album/:id/link-spotify', linkSpotify);

module.exports = router;
