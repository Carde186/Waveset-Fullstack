const pool = require('../config/database');
const { EVENTO_PUBBLICO } = require('../catalogo/pubblico');
const { immaginiArtisti } = require('../artistiProvider/immagini');
const { leggiImmagine } = require('../ticketmaster/immagini');

// Colonne di un evento, con alias "e" per la tabella evento. Condivise da
// /eventi e /novita.
const COLONNE_EVENTO = `e.id, e.titolo, e.data_evento, e.ora_evento, e.luogo,
    e.citta, e.latitudine, e.longitudine,
    (SELECT JSON_EXTRACT(sf.snapshot, '$.immagine') FROM ticketmaster_evento_fonte sf
     WHERE sf.evento_id=e.id) AS immagine_evento`;

// Ticketmaster è pubblico solo con approvazione automatica persistita.
// Il catalogo manuale e i filtri restano invariati. Una fonte annullata è nascosta.
const SOLO_PUBBLICATI = "e.stato = 'pubblicato' AND (e.fonte <> 'ticketmaster' OR EXISTS (SELECT 1 FROM ollama_evento_job oj WHERE oj.evento_id=e.id AND oj.stato='approva')) AND NOT EXISTS (SELECT 1 FROM ticketmaster_evento_fonte sf WHERE sf.evento_id=e.id AND sf.stato_fonte='canceled')" + ` AND ${EVENTO_PUBBLICO}`;

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

    for (const riga of await immaginiArtisti(righe)) {
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

    return righe.map(evento => {
        const immagine = leggiImmagine(evento.immagine_evento);
        return {
            id: evento.id,
            titolo: evento.titolo,
            data_evento: evento.data_evento,
            ora_evento: evento.ora_evento,
            luogo: evento.luogo,
            citta: evento.citta,
            immagine_url: immagine?.url ?? null,
            immagine,
            latitudine: numeroONull(evento.latitudine),
            longitudine: numeroONull(evento.longitudine),
            lineup: lineup.get(evento.id),
            ...(evento.fonte === 'ticketmaster' ? {
                fonte: evento.fonte, stato_fonte: evento.stato_fonte ?? 'unknown',
                ultimo_controllo: evento.ultimo_controllo ?? null,
                assente_fonte: Boolean(evento.assente_fonte), modifiche_fonte: Boolean(evento.modifiche_fonte),
            } : {}),
        };
    });
}

module.exports = {
    COLONNE_EVENTO,
    CON_ARTISTA_SEGUITO,
    SOLO_PUBBLICATI,
    formattaEventi,
};
