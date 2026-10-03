require('dotenv').config({ quiet: true });
const pool = require('../src/config/database');
const { eseguiJob } = require('../src/ticketmaster/job');
const { configurazione } = require('../src/ticketmaster/configurazione');
const { avviaScheduler } = require('../src/ticketmaster/scheduler');
const controller = new AbortController();
async function main(args = process.argv.slice(2)) {
    const continuo = args.includes('--continuo');
    const selezione = args.find(a => a.startsWith('--artisti='));
    if (args.some(a => !['--continuo', '--force'].includes(a) && !a.startsWith('--artisti='))) throw new Error('ARGOMENTI_NON_VALIDI');
    const ids = selezione ? selezione.slice(10).split(',').map(Number) : null;
    if (ids && (!ids.length || ids.some(n => !Number.isSafeInteger(n) || n < 1))) throw new Error('ARTISTI_NON_VALIDI');
    if (continuo && (ids || args.includes('--force'))) throw new Error('SCHEDULER_NON_LIMITABILE');
    configurazione(); // Validare anche quando manca la chiave.
    const esegui = () => eseguiJob({ pool, ids, forza: args.includes('--force'), signal: controller.signal });
    if (!continuo) {
        const r = await esegui();
        console.log('Ticketmaster sync', r);
        if (['errore', 'disabilitato'].includes(r.esito) || r.falliti) process.exitCode = 1;
        await pool.end(); return;
    }
    let giaFermato = false;
    const scheduler = avviaScheduler({ esegui });
    const ferma = async () => {
        if (giaFermato) return;
        giaFermato = true; controller.abort(); await scheduler.ferma(); await pool.end();
    };
    process.once('SIGTERM', ferma); process.once('SIGINT', ferma);
}
if (require.main === module) main().catch(async () => {
    console.error('Ticketmaster sync: errore di avvio o persistenza (nessun dettaglio riservato)');
    process.exitCode = 1; await pool.end();
});
module.exports = { main };
