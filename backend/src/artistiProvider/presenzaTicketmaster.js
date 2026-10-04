const { creaClientTicketmaster } = require('../servizi/ticketmaster');
function normalizzaNome(v) {
    return v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function creaControllo({ env = process.env, client, ora = Date.now } = {}) {
    return async nome => {
        const controllatoAt = new Date(ora()).toISOString();
        try {
            // Budget complessivo: una fonte lenta non trattiene il salvataggio.
            const signal = AbortSignal.timeout(5000);
            const fonte = client ?? creaClientTicketmaster({ chiave: env.TICKETMASTER_API_KEY, timeoutMs: 3000,
                tentativi: 0, maxPagine: 3, maxRichieste: 3, pausaMs: 300, signal });
            const candidati = await fonte.cercaAttractions(nome);
            const attractions = [...new Map(candidati.filter(a => normalizzaNome(a.name) === normalizzaNome(nome)).map(a => [a.id, { id: a.id, name: a.name }])).values()];
            return { stato: attractions.length ? 'trovato' : 'non_trovato', attractions,
                ambiguo: attractions.length > 1, controllatoAt };
        } catch {
            return { stato: 'non_verificato', attractions: [], ambiguo: false, controllatoAt };
        }
    };
}
module.exports = { creaControllo, normalizzaNome };
