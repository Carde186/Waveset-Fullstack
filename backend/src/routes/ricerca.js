const express = require('express');

const pool = require('../config/database');
const formattaBrano = require('../utilita/formattaBrano');

const router = express.Router();

const LUNGHEZZA_MINIMA = 2;
const LUNGHEZZA_MASSIMA = 100;
const LIMITE_PER_SEZIONE = 20;

// In LIKE "%" (qualunque sequenza) e "_" (qualunque carattere) sono jolly: se
// arrivassero dall'utente così come sono, cercare "%" restituirebbe tutto il
// catalogo. Si trasformano in caratteri normali, con "\" come carattere di
// escape (dichiarato nella query con ESCAPE). La query resta comunque
// parametrizzata: questo non riguarda la SQL injection, ma il significato del
// testo dentro LIKE.
function escapeLike(testo) {
    return testo.replace(/[\\%_]/g, carattere => `\\${carattere}`);
}

// Nessun LOWER() e nessun ILIKE (che esiste solo in PostgreSQL): le colonne
// usano la collation utf8mb4_0900_ai_ci, quindi LIKE ignora già maiuscole
// (ci) e accenti (ai).
async function cerca(req, res) {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    if (q.length > LUNGHEZZA_MASSIMA) {
        res.status(400).json({
            messaggio: `Ricerca troppo lunga (massimo ${LUNGHEZZA_MASSIMA} caratteri)`,
        });
        return;
    }

    // Sotto i 2 caratteri quasi ogni riga corrisponderebbe: niente risultati
    // invece di un errore, così l'app può chiamare senza casi speciali.
    if (q.length < LUNGHEZZA_MINIMA) {
        res.json({ artisti: [], brani: [] });
        return;
    }

    const testo = escapeLike(q);
    const contiene = `%${testo}%`;
    const iniziaCon = `${testo}%`;

    // Ordine: prima chi inizia con il testo cercato, poi chi lo contiene più
    // avanti, poi alfabetico ("lu": "Lucent Wave" prima di "Portale Lucente").
    const [artisti] = await pool.query(
        `SELECT id, nome, immagine_url
         FROM artista
         WHERE nome LIKE ? ESCAPE '\\\\'
         ORDER BY nome LIKE ? ESCAPE '\\\\' DESC, nome
         LIMIT ?`,
        [contiene, iniziaCon, LIMITE_PER_SEZIONE],
    );

    // Brani cercati solo per titolo: cercando un artista lo si trova nella
    // sezione Artisti, senza ripeterne qui tutti i brani.
    const [brani] = await pool.query(
        `SELECT b.id, b.titolo, b.data_pubblicazione, b.url_spotify, b.collaboratori,
                a.id AS artista_id, a.nome AS artista_nome, a.immagine_url AS artista_immagine_url,
                al.id AS album_id, al.titolo AS album_titolo, al.copertina_url AS album_copertina_url
         FROM brano b
         INNER JOIN artista a ON a.id = b.artista_id
         LEFT JOIN album al ON al.id = b.album_id
         WHERE b.titolo LIKE ? ESCAPE '\\\\'
         ORDER BY b.titolo LIKE ? ESCAPE '\\\\' DESC, b.titolo
         LIMIT ?`,
        [contiene, iniziaCon, LIMITE_PER_SEZIONE],
    );

    res.json({ artisti, brani: brani.map(formattaBrano) });
}

router.get('/ricerca', cerca);

module.exports = router;
