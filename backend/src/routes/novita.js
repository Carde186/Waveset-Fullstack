const express = require('express');

const autenticazioneFacoltativa = require('../autenticazione/autenticazioneFacoltativa');
const pool = require('../config/database');
const formattaBrano = require('../utilita/formattaBrano');
const {
    COLONNE_EVENTO,
    CON_ARTISTA_SEGUITO,
    SOLO_PUBBLICATI,
    formattaEventi,
} = require('../utilita/eventi');

const router = express.Router();

const LIMITE_BRANI = 10;
const LIMITE_EVENTI = 5;

const SELECT_BRANO = `SELECT b.id, b.titolo, b.data_pubblicazione, b.url_spotify,
            a.id AS artista_id, a.nome AS artista_nome, a.immagine_url AS artista_immagine_url,
            al.id AS album_id, al.titolo AS album_titolo, al.copertina_url AS album_copertina_url
     FROM brano b
     INNER JOIN artista a ON a.id = b.artista_id
     LEFT JOIN album al ON al.id = b.album_id`;

// Feed "Novità" della Home: brani recenti ed eventi in arrivo degli artisti
// seguiti (CLAUDE.md, "brani/eventi recenti degli artisti seguiti").
// personalizzato: true se chi guarda segue qualcuno che ha almeno un brano
// o un evento futuro. Altrimenti (anonimi, chi non segue nessuno, chi segue
// solo artisti senza brani né eventi) le ultime uscite di tutto il
// catalogo, senza eventi: per i brani non esiste un dato di popolarità,
// quindi il fallback è per data. "personalizzato" serve all'app per
// scegliere il titolo della sezione.
async function novita(req, res) {
    if (req.utente) {
        const [brani] = await pool.query(
            `${SELECT_BRANO}
             INNER JOIN utente_artista ua ON ua.artista_id = b.artista_id
             WHERE ua.utente_id = ?
             ORDER BY b.data_pubblicazione DESC
             LIMIT ?`,
            [req.utente.id, LIMITE_BRANI],
        );

        const [eventi] = await pool.query(
            `SELECT ${COLONNE_EVENTO}
             FROM evento e
             WHERE e.data_evento >= CURDATE() AND ${SOLO_PUBBLICATI}
                 AND ${CON_ARTISTA_SEGUITO}
             ORDER BY e.data_evento, e.ora_evento
             LIMIT ?`,
            [req.utente.id, LIMITE_EVENTI],
        );

        if (brani.length > 0 || eventi.length > 0) {
            res.json({
                personalizzato: true,
                brani: brani.map(formattaBrano),
                eventi: await formattaEventi(eventi),
            });
            return;
        }
    }

    const [brani] = await pool.query(
        `${SELECT_BRANO}
         ORDER BY b.data_pubblicazione DESC
         LIMIT ?`,
        [LIMITE_BRANI],
    );

    res.json({
        personalizzato: false,
        brani: brani.map(formattaBrano),
        eventi: [],
    });
}

router.get('/novita', autenticazioneFacoltativa, novita);

module.exports = router;
