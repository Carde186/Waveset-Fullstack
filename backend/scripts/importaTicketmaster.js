// Avvio manuale, da terminale (CLAUDE.md: niente scheduler interno):
//   cd backend && node scripts/importaTicketmaster.js
require('dotenv').config();

const pool = require('../src/config/database');
const { importaEventi } = require('../src/ticketmaster/importa');

importaEventi()
    .then(riepilogo => {
        console.log('Import Ticketmaster completato:', riepilogo);
    })
    .catch(errore => {
        console.error('Import Ticketmaster fallito:', errore);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
