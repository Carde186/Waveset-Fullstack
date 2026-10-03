function configurazione(env = process.env) {
    function intero(nome, valore, min, max) {
        const raw = env[nome];
        if (raw === undefined || raw === '') return valore;
        const n = Number(raw);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Configurazione non valida: ${nome}`);
        return n;
    }
    return {
        attiva: env.TICKETMASTER_SYNC_ENABLED !== 'false',
        configurata: Boolean(env.TICKETMASTER_API_KEY?.trim()),
        intervalloMs: intero('TICKETMASTER_SYNC_INTERVAL_SEC', 28800, 60, 604800) * 1000,
        staleMs: intero('TICKETMASTER_SYNC_STALE_SEC', 86400, 60, 1209600) * 1000,
        maxArtisti: intero('TICKETMASTER_SYNC_MAX_ARTISTS', 50, 1, 500),
        maxPagine: intero('TICKETMASTER_SYNC_MAX_PAGES', 4, 1, 20),
        maxRichieste: intero('TICKETMASTER_SYNC_MAX_REQUESTS', 300, 1, 4500),
        timeoutMs: intero('TICKETMASTER_SYNC_TIMEOUT_MS', 10000, 1000, 30000),
    };
}
module.exports = { configurazione };
