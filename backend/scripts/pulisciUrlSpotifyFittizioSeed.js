// Rimuove i 4 url_spotify fittizi del seed dimostrativo (id inventati
// 0000000000000000000001..004, mai stati veri track Spotify — vedi
// db/init/02_seed.sql, dove sono già stati sostituiti con NULL per un DB
// nuovo/clonato). Corregge SOLO i 4 valori esatti elencati sotto: qualunque
// altro url_spotify (compresi eventuali NULL già presenti) resta
// invariato, non è nemmeno selezionato.
//
// Uso:
//   node scripts/pulisciUrlSpotifyFittizioSeed.js            (anteprima)
//   node scripts/pulisciUrlSpotifyFittizioSeed.js --applica  (applica)
require('dotenv').config();

const pool = require('../src/config/database');

const APPLICA = process.argv.includes('--applica');

const URL_FITTIZI = [
    'https://open.spotify.com/track/0000000000000000000001',
    'https://open.spotify.com/track/0000000000000000000002',
    'https://open.spotify.com/track/0000000000000000000003',
    'https://open.spotify.com/track/0000000000000000000004',
];

async function main() {
    console.log(
        APPLICA
            ? 'MODALITÀ: applicazione scritture'
            : 'MODALITÀ: sola anteprima, nessuna scrittura',
    );
    console.log('');

    const [righe] = await pool.query(
        'SELECT id, titolo, artista_id, url_spotify FROM brano WHERE url_spotify IN (?)',
        [URL_FITTIZI],
    );
    console.table(righe);

    if (!APPLICA) {
        await pool.end();
        return;
    }

    // Ricontrollo a freddo, immediatamente prima di scrivere: aggiorna
    // solo le righe che hanno ANCORA esattamente uno di quei 4 valori al
    // momento della scrittura (mai una WHERE più larga).
    const [risultato] = await pool.query(
        'UPDATE brano SET url_spotify = NULL WHERE url_spotify IN (?)',
        [URL_FITTIZI],
    );
    console.log('Righe aggiornate:', risultato.affectedRows);

    await pool.end();
}

main().catch(errore => {
    console.error('Pulizia fallita:', errore.message);
    process.exitCode = 1;
});
