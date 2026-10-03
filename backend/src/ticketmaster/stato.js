const { configurazione } = require('./configurazione');
async function statoPubblico(pool, env = process.env, adesso = new Date()) {
    const c = configurazione(env);
    const [righe] = await pool.query(`SELECT
        DATE_FORMAT(ultimo_tentativo,'%Y-%m-%dT%H:%i:%sZ') ultimo_tentativo,
        DATE_FORMAT(ultimo_successo,'%Y-%m-%dT%H:%i:%sZ') ultimo_successo,esito,errore
        FROM ticketmaster_sync_stato WHERE id=1`);
    const s = righe[0];
    const ultimo = s?.ultimo_successo ?? null;
    return {
        configurata: c.configurata, attiva: c.attiva && c.configurata,
        ultimo_tentativo: s?.ultimo_tentativo ?? null, ultimo_successo: ultimo,
        dati_vecchi: !ultimo || adesso.getTime() - new Date(ultimo).getTime() >= c.staleMs,
        errore_temporaneo: Boolean(s?.errore), parziale: s?.esito === 'parziale',
        intervallo_secondi: c.intervalloMs / 1000,
    };
}
module.exports = { statoPubblico };
