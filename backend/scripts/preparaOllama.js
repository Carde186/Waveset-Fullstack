require('dotenv').config({ quiet: true });
const pool = require('../src/config/database');
const { applicaSchema } = require('../src/ollama/schema');
(async () => {
    if (!process.argv.includes('--applica')) throw new Error();
    await applicaSchema(pool);
    console.log('Schema Ollama pronto: enum da_valutare, ollama_evento_job, ollama_evento_audit; snapshot conservati.');
})().catch(() => { console.error('OLLAMA_SCHEMA_FALLITO'); process.exitCode = 1; }).finally(() => pool.end());
