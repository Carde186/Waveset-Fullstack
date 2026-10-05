const express = require('express');

const autenticazioneFacoltativa = require('../autenticazione/autenticazioneFacoltativa');
const pool = require('../config/database');
const { statoPubblico } = require('../ticketmaster/stato');
const {
    COLONNE_EVENTO: COLONNE_EVENTO_CONDIVISE,
    CON_ARTISTA_SEGUITO,
    SOLO_PUBBLICATI,
    formattaEventi,
} = require('../utilita/eventi');

const router = express.Router();

// DATE è il giorno locale del locale, non un istante UTC. mysql2 senza
// dateStrings lo converte in Date: stabilizziamo solo le API eventi, senza
// cambiare pool, Novità o catalogo che condividono COLONNE_EVENTO.
const COLONNE_EVENTO = COLONNE_EVENTO_CONDIVISE.replace(
    'e.data_evento',
    "DATE_FORMAT(e.data_evento, '%Y-%m-%d') AS data_evento",
) + `,e.fonte,tm.stato_fonte,DATE_FORMAT(tm.ultimo_controllo,'%Y-%m-%dT%H:%i:%sZ') ultimo_controllo,
    tm.assente_dal IS NOT NULL assente_fonte,tm.modifiche_fonte`;
const FONTE = 'LEFT JOIN ticketmaster_evento_fonte tm ON tm.evento_id=e.id';

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

    const genere = req.query.genere_id;
    if (genere !== undefined && (typeof genere !== 'string' || !/^[1-9]\d*$/.test(genere) ||
        !Number.isSafeInteger(Number(genere)) || Number(genere) > 2147483647)) {
        return res.status(400).json({ messaggio: 'genere_id non valido' });
    }

    if (filtro === 'seguiti' && !req.utente) {
        res.status(401).json({ messaggio: 'Sessione non valida' });
        return;
    }

    // EXISTS include qualunque artista della lineup senza duplicare gli eventi
    // con più artisti/generi. Il vecchio filtro API seguiti resta compatibile.
    const condizioni = [], parametri = [];
    if (filtro === 'seguiti') {
        condizioni.push(CON_ARTISTA_SEGUITO);
        parametri.push(req.utente.id);
    }
    if (genere !== undefined) {
        condizioni.push(`EXISTS (SELECT 1 FROM evento_artista genere_ea
            INNER JOIN artista_genere genere_ag ON genere_ag.artista_id=genere_ea.artista_id
            WHERE genere_ea.evento_id=e.id AND genere_ag.genere_id=?)`);
        parametri.push(Number(genere));
    }
    const [righe] = await pool.query(
        `SELECT ${COLONNE_EVENTO}
         FROM evento e ${FONTE}
         WHERE e.data_evento >= CURDATE() AND ${SOLO_PUBBLICATI}
         ${condizioni.map(c => `AND ${c}`).join('\n')}
         ORDER BY e.data_evento, e.ora_evento`,
        parametri,
    );

    res.json(await formattaEventi(righe));
}

async function dettaglioEvento(req, res) {
    const [righe] = await pool.query(
        `SELECT ${COLONNE_EVENTO} FROM evento e ${FONTE}
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
router.get('/eventi/sincronizzazione', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await statoPubblico(pool)); }
    catch { throw new Error('Stato sincronizzazione non disponibile'); }
});
router.get('/eventi/:id', dettaglioEvento);

module.exports = router;
