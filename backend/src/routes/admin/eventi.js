const express = require('express');

const pool = require('../../config/database');

const router = express.Router();

function validaId(req, res, next, valore) {
    if (!/^[1-9]\d*$/.test(valore) || Number(valore) > 2147483647) {
        return res.status(400).json({ messaggio: 'ID non valido' });
    }
    next();
}
router.param('id', validaId);
router.param('artistaId', validaId);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

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
            id_ticketmaster: riga.id_ticketmaster,
            id_attraction_ticketmaster: riga.id_attraction_ticketmaster,
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
        fonte: evento.fonte,
        stato: evento.stato,
        lineup,
    };
}

async function elencaCoda(req, res) {
    const [righe] = await pool.query(
        `SELECT id, titolo, DATE_FORMAT(data_evento, '%Y-%m-%d') data_evento, ora_evento, luogo, citta,
                latitudine, longitudine, motivo_revisione, fonte, stato
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
        "SELECT *, DATE_FORMAT(data_evento, '%Y-%m-%d') data_evento FROM evento WHERE id = ? AND stato = 'in_coda'",
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
        `UPDATE evento e LEFT JOIN ticketmaster_evento_fonte sf ON sf.evento_id=e.id
         SET ${campi.map(c => `e.${c} = ?`).join(', ')}, sf.protetto_admin=TRUE WHERE e.id = ? AND e.stato='in_coda'`,
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

    if (evento.latitudine === null || evento.longitudine === null ||
        !Number.isFinite(Number(evento.latitudine)) || !Number.isFinite(Number(evento.longitudine)) ||
        Math.abs(Number(evento.latitudine)) > 90 || Math.abs(Number(evento.longitudine)) > 180) {
        res.status(400).json({
            messaggio: 'Imposta le coordinate prima di approvare',
        });
        return;
    }
    const [fonti] = await pool.query('SELECT stato_fonte FROM ticketmaster_evento_fonte WHERE evento_id = ?', [evento.id]);
    if (fonti[0]?.stato_fonte === 'canceled') return res.status(400).json({ messaggio: 'Evento annullato dalla fonte' });

    const [aggiornamento] = await pool.query(
        "UPDATE evento e LEFT JOIN ticketmaster_evento_fonte sf ON sf.evento_id=e.id SET e.stato = 'pubblicato', e.motivo_revisione = NULL, sf.protetto_admin=TRUE WHERE e.id = ? AND e.stato='in_coda' AND (sf.stato_fonte IS NULL OR sf.stato_fonte <> 'canceled')",
        [req.params.id],
    );

    if (!aggiornamento.affectedRows) return res.status(409).json({ messaggio: 'Evento già revisionato' });

    res.status(204).end();
}

async function scartaEvento(req, res) {
    const motivo = req.body?.motivo;
    if (motivo !== undefined && (typeof motivo !== 'string' || motivo.trim().length > 255)) {
        return res.status(400).json({ messaggio: 'Motivazione non valida' });
    }
    const evento = await trovaEventoInCoda(req.params.id);
    if (!evento) {
        res.status(404).json({ messaggio: 'Evento in coda non trovato' });
        return;
    }

    // Soft delete: la riga resta, con id_esterno intatto, così un import
    // successivo che ritrova lo stesso evento lo salta invece di
    // reinserirlo (vedi src/ticketmaster/importa.js).
    const [aggiornamento] = await pool.query("UPDATE evento e LEFT JOIN ticketmaster_evento_fonte sf ON sf.evento_id=e.id SET e.stato = 'scartato', e.motivo_revisione = ?, sf.protetto_admin=TRUE WHERE e.id = ? AND e.stato='in_coda'", [
        motivo?.trim() || null,
        req.params.id,
    ]);
    if (!aggiornamento.affectedRows) return res.status(409).json({ messaggio: 'Evento già revisionato' });

    res.status(204).end();
}

// Conferma esplicita di UN singolo collegamento artista↔attraction. Non è
// un effetto collaterale di approvaEvento: approvare l'evento pubblica il
// lineup così com'è (già filtrato per nome esatto in fase di import), ma
// NON fissa id_ticketmaster per nessun artista — l'ADMIN deve confermare
// ciascun collegamento a parte, anche per eventi con più artisti in coda.
async function confermaCollegamento(req, res) {
    const { id: eventoId, artistaId } = req.params;
    if (!await trovaEventoInCoda(eventoId)) return res.status(404).json({ messaggio: 'Evento in coda non trovato' });

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

    // Una conferma precedente non si sostituisce con un candidato diverso.
    try {
        const [aggiornamento] = await pool.query(
            'UPDATE artista SET id_ticketmaster = ? WHERE id = ? AND (id_ticketmaster IS NULL OR id_ticketmaster = ?)',
            [idAttraction, artistaId, idAttraction],
        );
        if (!aggiornamento.affectedRows) return res.status(409).json({ messaggio: 'Collegamento già confermato con altra attraction' });
    } catch (errore) {
        if (errore.code === 'ER_DUP_ENTRY') return res.status(409).json({ messaggio: 'Attraction già collegata a un altro artista' });
        throw errore;
    }

    res.status(204).end();
}

router.get('/coda', elencaCoda);
router.get('/coda/:id', dettaglioCoda);
// Consultabile anche dopo la decisione, mantenendo /coda/:id retrocompatibile.
router.get('/:id', async (req, res) => {
    const [righe] = await pool.query("SELECT *, DATE_FORMAT(data_evento, '%Y-%m-%d') data_evento FROM evento WHERE id = ?", [req.params.id]);
    if (!righe.length) return res.status(404).json({ messaggio: 'Evento non trovato' });
    const lineup = await lineupConCandidati([righe[0].id]);
    res.json(formattaEventoCoda(righe[0], lineup.get(righe[0].id)));
});
// Snapshot normalizzato della fonte, disponibile anche per eventi già
// approvati/scartati. Nessuna chiave o risposta remota grezza.
router.get('/:id/fonte', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const [righe] = await pool.query("SELECT snapshot,stato_fonte,protetto_admin,modifiche_fonte,DATE_FORMAT(ultimo_controllo,'%Y-%m-%dT%H:%i:%sZ') ultimo_controllo,DATE_FORMAT(assente_dal,'%Y-%m-%dT%H:%i:%sZ') assente_dal FROM ticketmaster_evento_fonte WHERE evento_id=?", [req.params.id]);
    if (!righe.length) return res.status(404).json({ messaggio: 'Fonte evento non disponibile' });
    res.json({ ...righe[0], protetto_admin: Boolean(righe[0].protetto_admin), modifiche_fonte: Boolean(righe[0].modifiche_fonte) });
});
router.patch('/:id', correggiEvento);
router.post('/:id/approva', approvaEvento);
router.post('/:id/scarta', scartaEvento);
router.post(
    '/:id/artisti/:artistaId/conferma-collegamento',
    confermaCollegamento,
);

// Non inoltrare a log globali query SQL, motivazioni o dettagli della fonte.
router.use((errore, req, res, next) => {
    next(new Error('Revisione evento non riuscita'));
});

module.exports = router;
