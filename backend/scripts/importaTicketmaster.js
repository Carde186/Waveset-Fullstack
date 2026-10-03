// Alias storico: passa dallo stesso lock/cache del worker, senza import paralleli.
const { main } = require('./sincronizzaTicketmaster');
main().catch(async () => { console.error('Ticketmaster sync: avvio non riuscito'); process.exitCode = 1; await require('../src/config/database').end(); });
