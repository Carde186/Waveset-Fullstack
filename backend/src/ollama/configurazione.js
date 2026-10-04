function configurazione(env = process.env) {
    let url;
    try {
        url = new URL(env.OLLAMA_URL);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    } catch { throw new Error('OLLAMA_CONFIGURAZIONE_URL'); }
    const modello = env.OLLAMA_MODEL?.trim();
    if (!modello || modello.length > 100 || !/^[\w.\-/:]+$/.test(modello)) throw new Error('OLLAMA_CONFIGURAZIONE_MODELLO');
    function numero(nome, valore, minimo, massimo, intero = true) {
        const n = Number(env[nome] ?? valore);
        if (!Number.isFinite(n) || n < minimo || n > massimo || (intero && !Number.isInteger(n))) throw new Error(`OLLAMA_CONFIGURAZIONE_${nome}`);
        return n;
    }
    return { url: url.origin, modello,
        timeout: numero('OLLAMA_TIMEOUT_MS', 45000, 100, 300000),
        soglia: numero('OLLAMA_SOGLIA_CONFIDENZA', .85, 0, 1, false),
        tentativi: numero('OLLAMA_MAX_TENTATIVI', 3, 1, 10),
        concorrenza: numero('OLLAMA_CONCORRENZA', 1, 1, 4),
        intervallo: numero('OLLAMA_INTERVALLO_MS', 30000, 1000, 3600000),
        lotto: numero('OLLAMA_LOTTO', 20, 1, 100),
    };
}
module.exports = { configurazione };
