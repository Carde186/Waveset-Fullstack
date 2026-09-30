const URL_EVENTI = 'https://app.ticketmaster.com/discovery/v2/events.json';
const URL_EVENTO_SINGOLO = 'https://app.ticketmaster.com/discovery/v2/events';

// Isolata in un modulo a sé (invece che dentro importa.js) per due motivi:
// i test la sostituiscono con mock.method (node:test), senza fare chiamate
// di rete vere; e la funzione fa solo da confine con l'API esterna, senza
// nessuna logica di importazione al suo interno.
//
// Un solo parametro, mai entrambi insieme: keyword (ricerca per nome, prima
// volta) oppure attractionId (l'artista ha già un id_ticketmaster confermato
// dall'ADMIN, la ricerca diventa precisa e non passa più dal nome).
async function cercaEventi({ keyword, attractionId }) {
    const parametri = new URLSearchParams({
        apikey: process.env.TICKETMASTER_API_KEY,
        classificationName: 'music',
        size: '50',
    });

    if (attractionId) {
        parametri.set('attractionId', attractionId);
    } else {
        parametri.set('keyword', keyword);
    }

    const risposta = await fetch(`${URL_EVENTI}?${parametri}`);

    if (!risposta.ok) {
        throw new Error(
            `Ticketmaster ha risposto ${risposta.status} per "${keyword ?? attractionId}"`,
        );
    }

    const dati = await risposta.json();
    return dati._embedded?.events ?? [];
}

// Dettaglio di un singolo evento già noto (per id Ticketmaster), usata dallo
// script di ricalcolo una tantum (scripts/ricalcolaLineupEventiEsistenti.js)
// per rileggere il lineup con la regola di matching aggiornata, senza
// rifare una ricerca per nome. null se Ticketmaster non lo trova più (evento
// rimosso/scaduto lato loro): chi chiama decide cosa farne, qui non si
// solleva un errore per un 404, che è un esito legittimo.
async function recuperaEvento(idEsterno) {
    const parametri = new URLSearchParams({
        apikey: process.env.TICKETMASTER_API_KEY,
    });

    const risposta = await fetch(
        `${URL_EVENTO_SINGOLO}/${idEsterno}.json?${parametri}`,
    );

    if (risposta.status === 404) {
        return null;
    }

    if (!risposta.ok) {
        throw new Error(
            `Ticketmaster ha risposto ${risposta.status} per l'evento ${idEsterno}`,
        );
    }

    return risposta.json();
}

module.exports = { cercaEventi, recuperaEvento };
