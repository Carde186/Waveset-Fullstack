require('dotenv').config({ quiet: true });
const pool = require('../src/config/database');
const { configurazione } = require('../src/ollama/configurazione');
const { creaClient } = require('../src/ollama/client');
const { esegui } = require('../src/ollama/worker');
let fermato = false;
let risveglia;
process.on('SIGTERM', () => { fermato = true; risveglia?.(); });
process.on('SIGINT', () => { fermato = true; risveglia?.(); });
(async () => {
    const config = configurazione();
    const client = creaClient(config);
    if (process.argv.includes('--check')) { console.log(JSON.stringify(await client.pronto())); return; }
    do {
        try { console.log(JSON.stringify(await esegui(pool, client, config))); }
        catch { console.error('OLLAMA_CICLO_FALLITO'); if (!process.argv.includes('--continuo')) throw new Error(); }
        if (process.argv.includes('--continuo') && !fermato) await new Promise(r => {
            const timer = setTimeout(r, config.intervallo);
            risveglia = () => { clearTimeout(timer); r(); };
        });
    } while (process.argv.includes('--continuo') && !fermato);
})().catch(() => { console.error('OLLAMA_NON_PRONTO: verificare configurazione, modello e database.'); process.exitCode = 1; }).finally(() => pool.end());
