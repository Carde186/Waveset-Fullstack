// DDL additivo e ripetibile. Avvio esplicito --applica o servizio Compose
// ticketmaster-schema; sui volumi esistenti fare prima il backup documentato.
require('dotenv').config({ quiet: true });
const { readFileSync } = require('node:fs');
const path = require('node:path');
const pool = require('../src/config/database');
async function prepara() {
    if (!process.argv.includes('--applica')) throw new Error('APPLICAZIONE_NON_RICHIESTA');
    const sql = readFileSync(path.join(__dirname, '../db/init/13_ticketmaster_sync_schema.sql'), 'utf8');
    // Questo file contiene solo CREATE TABLE; connessione senza multipleStatements.
    const istruzioni = sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    const connessione = await pool.getConnection();
    try {
        const [[lock]] = await connessione.query("SELECT GET_LOCK(CONCAT(DATABASE(),':ticketmaster-schema'),30) acquisito");
        if (lock.acquisito !== 1) throw new Error('SCHEMA_OCCUPATO');
        for (const istruzione of istruzioni) await connessione.query(istruzione);
        console.log('Schema Ticketmaster sync pronto: 3 tabelle additive');
    } finally {
        await connessione.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':ticketmaster-schema'))").catch(() => {});
        connessione.release();
    }
}
prepara().catch(() => { console.error('Schema Ticketmaster sync: preparazione non riuscita'); process.exitCode = 1; }).finally(() => pool.end());
