require('dotenv').config({ quiet: true });
const { readFileSync } = require('node:fs');
const path = require('node:path');
const pool = require('../src/config/database');
async function prepara() {
    if (!process.argv.includes('--applica')) throw new Error();
    const sql = ['14_apple_music_provider_schema.sql', '15_artista_ticketmaster_presenza_schema.sql'].map(file => readFileSync(path.join(__dirname, '../db/init/', file), 'utf8')).join('\n');
    const c = await pool.getConnection();
    let acquisito = false;
    try {
        const [[lock]] = await c.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':apple-music-schema'), 30) acquisito");
        acquisito = lock.acquisito === 1;
        if (!acquisito) throw new Error();
        for (const istruzione of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await c.query(istruzione);
        console.log('Schema provider pronto: artista_provider_link, artista_ticketmaster_presenza (CREATE IF NOT EXISTS).');
    } finally {
        if (acquisito) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':apple-music-schema'))");
        c.release();
    }
}
prepara().catch(() => { console.error('Schema provider non applicato: verificare DB e opzione --applica.'); process.exitCode = 1; }).finally(() => pool.end());
