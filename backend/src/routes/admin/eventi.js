const express = require('express');

const pool = require('../../config/database');

const router = express.Router();

const CAMPI_MODIFICABILI = [
    'titolo',
    'data_evento',
    'ora_evento',
    'luogo',
    'citta',
    'latitudine',
    'longitudine',
];

async function lineupConCandidati(idEventi) {
    const lineup = new Map(idEventi.map(id => [id, []]));

    if (idEventi.length === 0) {
        return lineup;
    }

    const [righe] = await pool.query(
        `SELECT ea.evento_id, a.id, a.nome, a.id_ticketmaster,
                ea.id_attraction_ticketmaster
         FROM evento_artista ea
         INNER JOIN artista a ON a.id = ea.artista_id
         WHERE ea.evento_id IN (?)
         ORDER BY a.nome`,
        [idEventi],
    );

    for (const riga of righe) {
        lineup.get(riga.evento_id).push({
            id: riga.id,
            nome: riga.nome,
            // true quando questo evento ha trovato un candidato Ticketmaster
            // per l'artista ma nessun ADMIN lo ha ancora confermato (vedi
            // POST .../conferma-collegamento) — è quello che decide se
            // mostrare il bottone "Conferma collegamento" nell'app.
            collegamento_da_confermare:
                riga.id_attraction_ticketmaster !== null &&
                riga.id_attraction_ticketmaster !== riga.id_ticketmaster,
        });
    }

    return lineup;
}

function formattaEventoCoda(evento, lineup) {
    return {
        id: evento.id,
        titolo: evento.titolo,
        data_evento: evento.data_evento,
        ora_evento: evento.ora_evento,
        luogo: evento.luogo,
        citta: evento.citta,
        latitudine:
            evento.latitudine === null ? null : Number(evento.latitudine),
        longitudine:
            evento.longitudine === null ? null : Number(evento.longitudine),
        motivo_revisione: evento.motivo_revisione,
        lineup,
    };
}

async function elencaCoda(req, res) {
    const [righe] = await pool.query(
        `SELECT id, titolo, data_evento, ora_evento, luogo, citta,
                latitudine, longitudine, motivo_revisione
         FROM evento
         WHERE stato = 'in_coda'
         ORDER BY data_evento, ora_evento`,
    );

    const lineup = await lineupConCandidati(righe.map(e => e.id));

    res.json(
        righe.map(evento => formattaEventoCoda(evento, lineup.get(evento.id))),
    );
}

async function trovaEventoInCoda(id) {
    const [righe] = await pool.query(
        "SELECT * FROM evento WHERE id = ? AND stato = 'in_coda'",
        [id],
    );
    return righe[0] ?? null;
}

// Dettaglio di un solo evento in coda: la schermata Android lo ricarica da
// qui invece di riusare l'oggetto ricevuto dalla lista (stesso pattern già
// in uso per Dettaglio playlist), così torna aggiornato dopo una modifica.
async function dettaglioCoda(req, res) {
    const evento = await trovaEventoInCoda(req.params.id);
    if (!evento) {
        res.status(404).json({ messaggio: 'Evento in coda non trovato' });
        return;
    }

    const lineup = await lineupConCandidati([evento.id]);
    res.json(formattaEventoCoda(evento, lineup.get(evento.id)));
}

// Correzioni manuali mentre l'evento è ancora in coda (coordinate, orario,
// lineup sbagliato...). La correzione del catalogo generico (CRUD completo,
// CLAUDE.md punto 1 dell'ADMIN) resta fuori da questo step.
async function correggiEvento(req, res) {
    const evento = await trovaEventoInCoda(req.params.id);
    if (!evento) {
        res.status(404).json({ messaggio: 'Evento in coda non trovato' });
        return;
    }

    const campi = Object.keys(req.body).filter(campo =>
        CAMPI_MODIFICABILI.includes(campo),
    );

    if (campi.length === 0) {
        res.status(400).json({ messaggio: 'Nessun campo da correggere' });
        return;
    }

    await pool.query(
        `UPDATE evento SET ${campi.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...campi.map(c => req.body[c]), req.params.id],
    );

    res.status(204).end();
}

// Un evento senza coordinate non deve poter essere approvato per errore: la
// mappa degli eventi (CLAUDE.md, schermata Eventi) richiede lat/lon per
// mostrare il marker. L'ADMIN deve prima correggerle con PATCH.
async function approvaEvento(req, res) {
    const evento = await trovaEventoInCoda(req.params.id);
    if (!evento) {
        res.status(404).json({ messaggio: 'Evento in coda non trovato' });
        return;
    }

    if (evento.latitudine === null || evento.longitudine === null) {
        res.status(400).json({
            messaggio: 'Imposta le coordinate prima di approvare',
        });
        return;
    }

    await pool.query(
        "UPDATE evento SET stato = 'pubblicato', motivo_revisione = NULL WHERE id = ?",
        [req.params.id],
    );

    res.status(204).end();
}

async function scartaEvento(req, res) {
    const evento = await trovaEventoInCoda(req.params.id);
    if (!evento) {
        res.status(404).json({ messaggio: 'Evento in coda non trovato' });
        return;
    }

    // Soft delete: la riga resta, con id_esterno intatto, così un import
    // successivo che ritrova lo stesso evento lo salta invece di
    // reinserirlo (vedi src/ticketmaster/importa.js).
    await pool.query("UPDATE evento SET stato = 'scartato' WHERE id = ?", [
        req.params.id,
    ]);

    res.status(204).end();
}

// Conferma esplicita di UN singolo collegamento artista↔attraction. Non è
// un effetto collaterale di approvaEvento: approvare l'evento pubblica il
// lineup così com'è (già filtrato per nome esatto in fase di import), ma
// NON fissa id_ticketmaster per nessun artista — l'ADMIN deve confermare
// ciascun collegamento a parte, anche per eventi con più artisti in coda.
async function confermaCollegamento(req, res) {
    const { id: eventoId, artistaId } = req.params;

    const [righe] = await pool.query(
        `SELECT id_attraction_ticketmaster FROM evento_artista
         WHERE evento_id = ? AND artista_id = ?`,
        [eventoId, artistaId],
    );

    const idAttraction = righe[0]?.id_attraction_ticketmaster;
    if (!idAttraction) {
        res.status(400).json({
            messaggio: 'Nessun collegamento Ticketmaster da confermare',
        });
        return;
    }

    await pool.query('UPDATE artista SET id_ticketmaster = ? WHERE id = ?', [
        idAttraction,
        artistaId,
    ]);

    res.status(204).end();
}

router.get('/coda', elencaCoda);
router.get('/coda/:id', dettaglioCoda);
router.patch('/:id', correggiEvento);
router.post('/:id/approva', approvaEvento);
router.post('/:id/scarta', scartaEvento);
router.post(
    '/:id/artisti/:artistaId/conferma-collegamento',
    confermaCollegamento,
);

module.exports = router;
