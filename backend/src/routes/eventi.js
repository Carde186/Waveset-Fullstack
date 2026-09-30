const express = require('express');

const autenticazioneFacoltativa = require('../autenticazione/autenticazioneFacoltativa');
const pool = require('../config/database');
const {
    COLONNE_EVENTO,
    CON_ARTISTA_SEGUITO,
    SOLO_PUBBLICATI,
    formattaEventi,
} = require('../utilita/eventi');

const router = express.Router();

// Eventi futuri (da oggi in poi), per data e ora. filtro=seguiti: solo
// quelli con almeno un artista seguito in lineup, e richiede la sessione.
async function elencaEventi(req, res) {
    const filtro = req.query.filtro ?? 'tutti';

    if (filtro !== 'tutti' && filtro !== 'seguiti') {
        res.status(400).json({
            messaggio: 'filtro deve essere tutti o seguiti',
        });
        return;
    }

    if (filtro === 'seguiti' && !req.utente) {
        res.status(401).json({ messaggio: 'Sessione non valida' });
        return;
    }

    const [righe] =
        filtro === 'seguiti'
            ? await pool.query(
                  `SELECT ${COLONNE_EVENTO}
                   FROM evento e
                   WHERE e.data_evento >= CURDATE() AND ${SOLO_PUBBLICATI}
                       AND ${CON_ARTISTA_SEGUITO}
                   ORDER BY e.data_evento, e.ora_evento`,
                  [req.utente.id],
              )
            : await pool.query(
                  `SELECT ${COLONNE_EVENTO}
                   FROM evento e
                   WHERE e.data_evento >= CURDATE() AND ${SOLO_PUBBLICATI}
                   ORDER BY e.data_evento, e.ora_evento`,
              );

    res.json(await formattaEventi(righe));
}

async function dettaglioEvento(req, res) {
    const [righe] = await pool.query(
        `SELECT ${COLONNE_EVENTO} FROM evento e
         WHERE e.id = ? AND ${SOLO_PUBBLICATI}`,
        [req.params.id],
    );

    if (righe.length === 0) {
        res.status(404).json({ messaggio: 'Evento non trovato' });
        return;
    }

    const [evento] = await formattaEventi(righe);
    res.json(evento);
}

router.get('/eventi', autenticazioneFacoltativa, elencaEventi);
router.get('/eventi/:id', dettaglioEvento);

module.exports = router;
