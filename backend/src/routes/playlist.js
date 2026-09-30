const express = require('express');

const pool = require('../config/database');

const router = express.Router();

// Tutte le route di questo file passano da richiediAutenticazione (montato in
// app.js), che imposta req.utente.id a partire dalla sessione.
//
// Verifica che la playlist esista E appartenga all'utente: questo controllo
// (utente_id = ?) è il meccanismo di isolamento tra utenti. Una playlist di un
// altro utente risponde 404 come una inesistente, così non si rivela nemmeno
// che esiste.
async function trovaPlaylistDiUtente(playlistId, utenteId) {
    const [righe] = await pool.query(
        'SELECT id, nome FROM playlist WHERE id = ? AND utente_id = ?',
        [playlistId, utenteId],
    );

    return righe[0] ?? null;
}

async function elencaPlaylist(req, res) {
    const [righe] = await pool.query(
        'SELECT id, nome FROM playlist WHERE utente_id = ? ORDER BY id',
        [req.utente.id],
    );

    res.json(righe);
}

async function creaPlaylist(req, res) {
    const { nome } = req.body ?? {};

    if (!nome) {
        res.status(400).json({ messaggio: 'nome obbligatorio' });
        return;
    }

    const [risultato] = await pool.query(
        'INSERT INTO playlist (nome, utente_id) VALUES (?, ?)',
        [nome, req.utente.id],
    );

    res.status(201).json({ id: risultato.insertId, nome });
}

async function dettaglioPlaylist(req, res) {
    const { id } = req.params;

    const playlist = await trovaPlaylistDiUtente(id, req.utente.id);

    if (!playlist) {
        res.status(404).json({ messaggio: 'Playlist non trovata' });
        return;
    }

    const [brani] = await pool.query(
        `SELECT b.id, b.titolo, b.url_spotify, a.nome AS artista_nome, pb.aggiunto_il
         FROM playlist_brano pb
         INNER JOIN brano b ON b.id = pb.brano_id
         INNER JOIN artista a ON a.id = b.artista_id
         WHERE pb.playlist_id = ?
         ORDER BY pb.aggiunto_il ASC`,
        [playlist.id],
    );

    res.json({ ...playlist, brani });
}

async function rinominaPlaylist(req, res) {
    const { id } = req.params;
    const { nome } = req.body ?? {};

    if (!nome) {
        res.status(400).json({ messaggio: 'nome obbligatorio' });
        return;
    }

    const playlist = await trovaPlaylistDiUtente(id, req.utente.id);

    if (!playlist) {
        res.status(404).json({ messaggio: 'Playlist non trovata' });
        return;
    }

    await pool.query(
        'UPDATE playlist SET nome = ? WHERE id = ? AND utente_id = ?',
        [nome, id, req.utente.id],
    );

    res.json({ id: playlist.id, nome });
}

async function eliminaPlaylist(req, res) {
    const { id } = req.params;

    const playlist = await trovaPlaylistDiUtente(id, req.utente.id);

    if (!playlist) {
        res.status(404).json({ messaggio: 'Playlist non trovata' });
        return;
    }

    await pool.query('DELETE FROM playlist WHERE id = ? AND utente_id = ?', [
        id,
        req.utente.id,
    ]);

    res.json({ messaggio: 'Playlist eliminata' });
}

async function aggiungiBrano(req, res) {
    const { id } = req.params;
    const { branoId } = req.body ?? {};

    if (!branoId) {
        res.status(400).json({ messaggio: 'branoId obbligatorio' });
        return;
    }

    const playlist = await trovaPlaylistDiUtente(id, req.utente.id);

    if (!playlist) {
        res.status(404).json({ messaggio: 'Playlist non trovata' });
        return;
    }

    await pool.query(
        'INSERT IGNORE INTO playlist_brano (playlist_id, brano_id) VALUES (?, ?)',
        [id, branoId],
    );

    res.status(201).json({ messaggio: 'Brano aggiunto alla playlist' });
}

async function rimuoviBrano(req, res) {
    const { id, branoId } = req.params;

    const playlist = await trovaPlaylistDiUtente(id, req.utente.id);

    if (!playlist) {
        res.status(404).json({ messaggio: 'Playlist non trovata' });
        return;
    }

    await pool.query(
        'DELETE FROM playlist_brano WHERE playlist_id = ? AND brano_id = ?',
        [id, branoId],
    );

    res.json({ messaggio: 'Brano rimosso dalla playlist' });
}

// Percorsi relativi: il router è montato su /api/playlist in app.js.
router.get('/', elencaPlaylist);
router.post('/', creaPlaylist);
router.get('/:id', dettaglioPlaylist);
router.put('/:id', rinominaPlaylist);
router.delete('/:id', eliminaPlaylist);
router.post('/:id/brani', aggiungiBrano);
router.delete('/:id/brani/:branoId', rimuoviBrano);

module.exports = router;
