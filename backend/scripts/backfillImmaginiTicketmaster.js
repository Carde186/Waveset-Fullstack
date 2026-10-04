require('dotenv').config({ quiet: true });
const pool = require('../src/config/database');
const { creaClientTicketmaster } = require('../src/servizi/ticketmaster');
const { backfillImmagini } = require('../src/ticketmaster/backfillImmagini');
async function main(args = process.argv.slice(2)) {
    if (args.some(a => !['--applica', '--live'].includes(a) && !/^--limite=\d+$/.test(a) && !/^--eventi=[1-9]\d*(,[1-9]\d*)*$/.test(a))) throw new Error('ARGOMENTI_NON_VALIDI');
    const limite = Number(args.find(a => a.startsWith('--limite='))?.slice(9) ?? 20);
    const ids = args.find(a => a.startsWith('--eventi='))?.slice(9).split(',').map(Number) ?? null;
    const client = args.includes('--live') ? creaClientTicketmaster({ pausaMs: 350, tentativi: 1, maxRichieste: 2 * limite }) : null;
    const r = await backfillImmagini({ pool, client, ids, limite, applica: args.includes('--applica') });
    console.log('Backfill immagini Ticketmaster', { ...r, richieste: client?.richieste() ?? 0 });
    if (r.esito !== 'ok' || r.errori || r.nonDisponibili || r.daRecuperare) process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
    console.error('Backfill immagini Ticketmaster non riuscito (nessun dettaglio riservato)');
    process.exitCode = 1;
}).finally(() => pool.end());
module.exports = { main };
