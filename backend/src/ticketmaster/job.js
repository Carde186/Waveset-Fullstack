const { configurazione } = require('./configurazione');
const { creaClientTicketmaster } = require('../servizi/ticketmaster');
const { conBlocco } = require('./repository');
const { sincronizza } = require('./sincronizza');
async function eseguiJob({ pool, env = process.env, ids = null, forza = false, signal, client, adesso } = {}) {
    const config = configurazione(env);
    if (!config.attiva || !config.configurata) return { esito: 'disabilitato', motivo: config.attiva ? 'CHIAVE_ASSENTE' : 'DISATTIVATO' };
    const api = client ?? creaClientTicketmaster({ chiave: env.TICKETMASTER_API_KEY, maxPagine: config.maxPagine,
        maxRichieste: config.maxRichieste, timeoutMs: config.timeoutMs, signal });
    return conBlocco(pool, repository => sincronizza({ repository, client: api, config, ids, forza, adesso }));
}
module.exports = { eseguiJob };
