const express = require('express');

const autenticazioneFacoltativa = require('../autenticazione/autenticazioneFacoltativa');
const richiediAutenticazione = require('../autenticazione/richiediAutenticazione');
const pool = require('../config/database');

const router = express.Router();

// "Esplora per genere". Ordine per numero di follower (l'unico dato di
// popolarità disponibile), poi per nome. Con escludi_seguiti=1 e una
// sessione, gli artisti già seguiti non compaiono: la sezione diventa un
// elenco di suggerimenti. Da anonimi il parametro non esclude nulla.
async function elencaArtisti(req, res) {
    const { genere_id: genereId, escludi_seguiti: escludiSeguiti } = req.query;

    const condizioni = [];
    const parametri = [];

    if (genereId) {
        condizioni.push(
            'a.id IN (SELECT artista_id FROM artista_genere WHERE genere_id = ?)',
        );
        parametri.push(genereId);
    }

    if (escludiSeguiti === '1' && req.utente) {
        condizioni.push(
            'a.id NOT IN (SELECT artista_id FROM utente_artista WHERE utente_id = ?)',
        );
        parametri.push(req.utente.id);
    }

    const where =
        condizioni.length > 0 ? `WHERE ${condizioni.join(' AND ')}` : '';

    const [righe] = await pool.query(
        `SELECT a.id, a.nome, a.immagine_url
         FROM artista a
         LEFT JOIN utente_artista follower ON follower.artista_id = a.id
         ${where}
         GROUP BY a.id, a.nome, a.immagine_url
         ORDER BY COUNT(follower.utente_id) DESC, a.nome`,
        parametri,
    );
    res.json(righe);
}

async function dettaglioArtista(req, res) {
    const { id } = req.params;

    const [righeArtista] = await pool.query(
        `SELECT id, nome, bio, immagine_url,
                immagine_autore, immagine_licenza, immagine_fonte_url, immagine_modificata
         FROM artista WHERE id = ?`,
        [id],
    );

    if (righeArtista.length === 0) {
        res.status(404).json({ messaggio: 'Artista non trovato' });
        return;
    }

    const [generi] = await pool.query(
        `SELECT g.id, g.nome
         FROM genere g
         INNER JOIN artista_genere ag ON ag.genere_id = g.id
         WHERE ag.artista_id = ?
         ORDER BY g.nome`,
        [id],
    );

    const [brani] = await pool.query(
        `SELECT id, titolo, album_id, data_pubblicazione, url_spotify
         FROM brano
         WHERE artista_id = ?
         ORDER BY data_pubblicazione DESC`,
        [id],
    );

    const [album] = await pool.query(
        `SELECT id, titolo, data_pubblicazione, copertina_url
         FROM album
         WHERE artista_id = ?
         ORDER BY data_pubblicazione DESC`,
        [id],
    );

    const [eventi] = await pool.query(
        `SELECT e.id, e.titolo, e.data_evento, e.ora_evento, e.luogo, e.citta
         FROM evento e
         INNER JOIN evento_artista ea ON ea.evento_id = e.id
         WHERE ea.artista_id = ? AND e.data_evento >= CURDATE()
             AND e.stato = 'pubblicato'
         ORDER BY e.data_evento ASC, e.ora_evento ASC`,
        [id],
    );

    // "seguito" è sempre presente (false da anonimi): l'app non deve
    // distinguere tra campo assente e artista non seguito.
    let seguito = false;
    if (req.utente) {
        const [righeFollow] = await pool.query(
            'SELECT 1 FROM utente_artista WHERE utente_id = ? AND artista_id = ?',
            [req.utente.id, id],
        );
        seguito = righeFollow.length > 0;
    }

    const riga = righeArtista[0];
    // credito_immagine è null per il seed dimostrativo (placeholder
    // picsum.photos, nessuna licenza da citare) — popolato solo per le
    // foto reali a licenza libera verificata (CLAUDE.md, "Catalogo
    // reale"). Il frontend mostra il credito SOLO quando non è null: mai
    // dedotto, mai mostrato "a vuoto".
    const creditoImmagine = riga.immagine_autore
        ? {
              autore: riga.immagine_autore,
              licenza: riga.immagine_licenza,
              fonte_url: riga.immagine_fonte_url,
              modificata: Boolean(riga.immagine_modificata),
          }
        : null;

    res.json({
        id: riga.id,
        nome: riga.nome,
        bio: riga.bio,
        immagine_url: riga.immagine_url,
        credito_immagine: creditoImmagine,
        generi,
        brani,
        album,
        eventi,
        seguito,
    });
}

async function esisteArtista(id) {
    const [righe] = await pool.query('SELECT 1 FROM artista WHERE id = ?', [
        id,
    ]);
    return righe.length > 0;
}

// PUT e DELETE (non POST) perché sono idempotenti: seguire due volte, o
// smettere di seguire chi non si segue, lascia lo stesso stato e risponde
// allo stesso modo. Così un doppio tap o un retry di rete non danno errore.
async function seguiArtista(req, res) {
    const { id } = req.params;

    if (!(await esisteArtista(id))) {
        res.status(404).json({ messaggio: 'Artista non trovato' });
        return;
    }

    await pool.query(
        'INSERT IGNORE INTO utente_artista (utente_id, artista_id) VALUES (?, ?)',
        [req.utente.id, id],
    );

    res.status(204).end();
}

async function smettiDiSeguire(req, res) {
    await pool.query(
        'DELETE FROM utente_artista WHERE utente_id = ? AND artista_id = ?',
        [req.utente.id, req.params.id],
    );

    res.status(204).end();
}

router.get('/artisti', autenticazioneFacoltativa, elencaArtisti);
router.get('/artisti/:id', autenticazioneFacoltativa, dettaglioArtista);
router.put('/artisti/:id/segui', richiediAutenticazione, seguiArtista);
router.delete('/artisti/:id/segui', richiediAutenticazione, smettiDiSeguire);

module.exports = router;
