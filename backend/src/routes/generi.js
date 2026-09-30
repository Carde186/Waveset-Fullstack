const express = require('express');

const autenticazioneFacoltativa = require('../autenticazione/autenticazioneFacoltativa');
const pool = require('../config/database');

const router = express.Router();

// Con una sessione, prima i generi degli artisti seguiti (quanti più
// artisti seguiti in quel genere, tanto più in alto), poi gli altri in ordine
// alfabetico. Da anonimi, o senza follow, il conteggio è 0 per tutti e
// resta l'ordine alfabetico.
async function elencaGeneri(req, res) {
    const [righe] = await pool.query(
        `SELECT g.id, g.nome
         FROM genere g
         LEFT JOIN artista_genere ag ON ag.genere_id = g.id
         LEFT JOIN utente_artista ua
             ON ua.artista_id = ag.artista_id AND ua.utente_id = ?
         GROUP BY g.id, g.nome
         ORDER BY COUNT(ua.artista_id) DESC, g.nome`,
        [req.utente ? req.utente.id : null],
    );
    res.json(righe);
}

router.get('/generi', autenticazioneFacoltativa, elencaGeneri);

module.exports = router;
