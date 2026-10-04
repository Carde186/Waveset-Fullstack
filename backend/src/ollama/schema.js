const fs = require('node:fs');
const path = require('node:path');
async function applicaSchema(pool) {
    const c = await pool.getConnection();
    let lock = false;
    try {
        const [[r]] = await c.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':ollama-schema'),30) acquisito");
        if (r.acquisito !== 1) throw new Error('OLLAMA_SCHEMA_OCCUPATO');
        lock = true;
        const [[colonna]] = await c.query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='evento' AND COLUMN_NAME='stato'");
        const sql = fs.readFileSync(path.join(__dirname, '../../db/init/16_ollama_eventi_schema.sql'), 'utf8');
        for (const s of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) {
            if (s.startsWith('ALTER TABLE') && colonna?.COLUMN_TYPE.includes("'da_valutare'")) continue;
            await c.query(s);
        }
    } finally {
        if (lock) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':ollama-schema'))");
        c.release();
    }
}
module.exports = { applicaSchema };
