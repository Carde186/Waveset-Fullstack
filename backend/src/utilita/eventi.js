const pool = require('../config/database');

// Colonne di un evento, con alias "e" per la tabella evento. Condivise da
// /eventi e /novita.
const COLONNE_EVENTO = `e.id, e.titolo, e.data_evento, e.ora_evento, e.luogo,
    e.citta, e.latitudine, e.longitudine`;

// Condizione da usare in ogni query pubblica (mai nella coda ADMIN, che deve
// vedere anche 'in_coda'): un evento importato da Ticketmaster resta
// invisibile finché l'ADMIN non lo approva. 'manuale' è sempre pubblicato
// (default della colonna), quindi il catalogo esistente non cambia.
const SOLO_PUBBLICATI = "e.stato = 'pubblicato'";

// Condizione "ha in lineup almeno un artista seguito dall'utente ?".
const CON_ARTISTA_SEGUITO = `EXISTS (
    SELECT 1
    FROM evento_artista ea
    INNER JOIN utente_artista ua ON ua.artista_id = ea.artista_id
    WHERE ea.evento_id = e.id AND ua.utente_id = ?
)`;

// mysql2 restituisce le colonne DECIMAL come stringhe (per non perdere
// precisione): la mappa vuole numeri. null resta null (evento senza
// coordinate, es. inserito a mano senza geocodifica).
function numeroONull(valore) {
    return valore === null ? null : Number(valore);
}

// Lineup di più eventi con una sola query (invece di una per evento),
// raggruppato per evento_id. Ordine alfabetico: il lineup non ha ruoli in v1
// (niente headliner), quindi il "primo artista" usato dal marker è il primo
// in ordine di nome, sempre lo stesso.
async function lineupPerEvento(idEventi) {
    const lineup = new Map(idEventi.map(id => [id, []]));

    if (idEventi.length === 0) {
        return lineup;
    }

    const [righe] = await pool.query(
        `SELECT ea.evento_id, a.id, a.nome, a.immagine_url
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
            immagine_url: riga.immagine_url,
        });
    }

    return lineup;
}

// Righe SQL (con COLONNE_EVENTO) -> JSON degli eventi, con il lineup.
async function formattaEventi(righe) {
    const lineup = await lineupPerEvento(righe.map(e => e.id));

    return righe.map(evento => ({
        id: evento.id,
        titolo: evento.titolo,
        data_evento: evento.data_evento,
        ora_evento: evento.ora_evento,
        luogo: evento.luogo,
        citta: evento.citta,
        latitudine: numeroONull(evento.latitudine),
        longitudine: numeroONull(evento.longitudine),
        lineup: lineup.get(evento.id),
    }));
}

module.exports = {
    COLONNE_EVENTO,
    CON_ARTISTA_SEGUITO,
    SOLO_PUBBLICATI,
    formattaEventi,
};
