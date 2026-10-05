require('dotenv').config({ quiet: true });
const pool = require('../src/config/database');
const { classifica } = require('../src/catalogo/classificazione');
classifica(pool, process.argv.includes('--applica')).then(r => console.log(JSON.stringify(r)))
    .catch(() => { console.error('Classificazione non applicata: verificare DB e generi del catalogo.'); process.exitCode = 1; })
    .finally(() => pool.end());
