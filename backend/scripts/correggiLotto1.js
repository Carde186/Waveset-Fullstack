// Correzione one-off per il lotto 1 (Carl Cox, Charlotte de Witte),
// SEPARATA dall'import normale (scripts/importaCatalogoRealeLotto1.js):
// quello non fa mai un UPDATE su una riga già presente per principio (la
// correzione di un dato già importato è un'azione ADMIN a sé, CLAUDE.md,
// "Cosa fa davvero l'ADMIN") — questa è esattamente quell'azione a sé,
// esplicita e verificabile prima di scrivere.
//
// Due correzioni indipendenti, entrambe idempotenti e sicure da rilanciare
// più volte:
// (a) rinomina 2 titoli che nascondevano un featuring reale — verificato su
//     Apple e Spotify, assente solo su MusicBrainz (anche a livello di
//     singola recording, non solo di release — ricontrollato apposta);
// (b) popola url_spotify sui 6 brani reali del lotto, oggi NULL — MAI
//     sovrascrive un valore già presente, qualunque esso sia.
//
// Uso:
//   node scripts/correggiLotto1.js            (anteprima, nessuna scrittura)
//   node scripts/correggiLotto1.js --applica  (applica le correzioni)
require('dotenv').config();

const pool = require('../src/config/database');

const APPLICA = process.argv.includes('--applica');

const RINOMINE_TITOLO = [
    {
        artistaNome: 'Carl Cox',
        titoloVecchio: 'Short Black',
        titoloNuovo: 'Short Black (feat. Juanita Timpanaro)',
    },
    {
        artistaNome: 'Carl Cox',
        titoloVecchio: 'We Rob Together',
        titoloNuovo: 'We Rob Together (feat. The Digital Primate)',
    },
];

// "titoli": tollera sia il titolo precedente sia quello corretto, così
// questo script funziona indipendentemente dall'ordine in cui le due
// correzioni (rinomina e url_spotify) vengono applicate.
const URL_SPOTIFY_BRANI = [
    {
        artistaNome: 'Carl Cox',
        titoli: ['Short Black', 'Short Black (feat. Juanita Timpanaro)'],
        url: 'https://open.spotify.com/track/2cGIsN2T7AfRkMJslDRQ17',
    },
    {
        artistaNome: 'Carl Cox',
        titoli: ['Bread & Butter'],
        url: 'https://open.spotify.com/track/5zaQH37CuI5P6l1bbsHinh',
    },
    {
        artistaNome: 'Carl Cox',
        titoli: [
            'We Rob Together',
            'We Rob Together (feat. The Digital Primate)',
        ],
        url: 'https://open.spotify.com/track/2RDEoNn9RPgGSOG4aWveCl',
    },
    {
        artistaNome: 'Charlotte de Witte',
        titoli: ['The Realm'],
        url: 'https://open.spotify.com/track/5oUM6niJ1fzxxSTah13Osf',
    },
    {
        artistaNome: 'Charlotte de Witte',
        titoli: ['Vidmahe'],
        url: 'https://open.spotify.com/track/5BSiyXPRW1BCtN57VX4ovu',
    },
    {
        artistaNome: 'Charlotte de Witte',
        titoli: ['Memento Mori'],
        url: 'https://open.spotify.com/track/14FZvKr4HJKlAzf2SUSb3J',
    },
];

async function trovaArtistaUnivoco(connessione, nome) {
    const [righe] = await connessione.query(
        'SELECT id FROM artista WHERE nome = ?',
        [nome],
    );
    return righe.length === 1 ? righe[0].id : null;
}

async function rinominaTitolo(connessione, voce, applica) {
    const artistaId = await trovaArtistaUnivoco(connessione, voce.artistaNome);
    if (!artistaId) {
        return { esito: `artista "${voce.artistaNome}" non trovato — saltato` };
    }

    const [righeVecchie] = await connessione.query(
        'SELECT id FROM brano WHERE titolo = ? AND artista_id = ?',
        [voce.titoloVecchio, artistaId],
    );
    const [righeNuove] = await connessione.query(
        'SELECT id FROM brano WHERE titolo = ? AND artista_id = ?',
        [voce.titoloNuovo, artistaId],
    );

    // Assenza del titolo nuovo verificata ESPLICITAMENTE prima di scrivere
    // (non solo la presenza del vecchio): se esistesse già, rinominare
    // creerebbe due righe con lo stesso titolo per lo stesso artista.
    if (righeNuove.length > 0) {
        return { esito: 'già corretto (il titolo nuovo esiste già)' };
    }
    if (righeVecchie.length === 0) {
        return {
            esito: 'titolo precedente non trovato — niente da correggere',
        };
    }
    if (righeVecchie.length > 1) {
        return {
            esito: 'PIÙ righe con il titolo precedente: non scelgo quale rinominare, va risolto a mano',
        };
    }

    const id = righeVecchie[0].id;
    if (!applica) {
        return { esito: `da rinominare (anteprima) — id ${id}` };
    }

    // Ricontrollo a freddo, immediatamente prima di scrivere: lo stato
    // potrebbe essere cambiato tra l'anteprima e l'applicazione.
    const [[fresca]] = await connessione.query(
        'SELECT titolo FROM brano WHERE id = ?',
        [id],
    );
    if (!fresca || fresca.titolo !== voce.titoloVecchio) {
        return {
            esito: 'stato cambiato tra anteprima e applicazione — saltato, non si tocca',
        };
    }

    await connessione.query('UPDATE brano SET titolo = ? WHERE id = ?', [
        voce.titoloNuovo,
        id,
    ]);
    return { esito: `rinominato — id ${id}` };
}

async function popolaUrlSpotify(connessione, voce, applica) {
    const artistaId = await trovaArtistaUnivoco(connessione, voce.artistaNome);
    if (!artistaId) {
        return { esito: `artista "${voce.artistaNome}" non trovato — saltato` };
    }

    const [righe] = await connessione.query(
        'SELECT id, url_spotify FROM brano WHERE titolo IN (?) AND artista_id = ?',
        [voce.titoli, artistaId],
    );
    if (righe.length === 0) {
        return {
            esito: 'brano non trovato con nessuno dei titoli noti — saltato',
        };
    }
    if (righe.length > 1) {
        return {
            esito: 'PIÙ righe combacianti: non scelgo quale aggiornare, va risolto a mano',
        };
    }

    const riga = righe[0];
    if (riga.url_spotify !== null) {
        return {
            esito: `già presente, non sovrascritto — id ${riga.id}`,
        };
    }

    if (!applica) {
        return { esito: `da popolare (anteprima) — id ${riga.id}` };
    }

    const [[fresca]] = await connessione.query(
        'SELECT url_spotify FROM brano WHERE id = ?',
        [riga.id],
    );
    if (!fresca || fresca.url_spotify !== null) {
        return {
            esito: 'stato cambiato tra anteprima e applicazione — saltato, non si tocca',
        };
    }

    await connessione.query('UPDATE brano SET url_spotify = ? WHERE id = ?', [
        voce.url,
        riga.id,
    ]);
    return { esito: `popolato — id ${riga.id}` };
}

// Esportata così com'è: il test di idempotenza (test/correggiLotto1.test.js)
// la richiama direttamente con dati di prova (mai i titoli reali di Carl
// Cox/Charlotte de Witte), stessa apertura/chiusura di transazione di
// applicaLotto in importaCatalogoRealeLotto1.js.
async function correggi(connessione, rinomine, urlSpotify, applica) {
    const risultati = [];

    if (applica) {
        await connessione.beginTransaction();
    }

    try {
        for (const voce of rinomine) {
            const r = await rinominaTitolo(connessione, voce, applica);
            risultati.push({
                tipo: 'rinomina titolo',
                dettaglio: `"${voce.titoloVecchio}" -> "${voce.titoloNuovo}"`,
                ...r,
            });
        }

        for (const voce of urlSpotify) {
            const r = await popolaUrlSpotify(connessione, voce, applica);
            risultati.push({
                tipo: 'url_spotify',
                dettaglio: voce.titoli[voce.titoli.length - 1],
                ...r,
            });
        }
    } catch (errore) {
        if (applica) {
            await connessione.rollback();
        }
        throw errore;
    }

    if (applica) {
        await connessione.commit();
    }

    return risultati;
}

module.exports = {
    RINOMINE_TITOLO,
    URL_SPOTIFY_BRANI,
    rinominaTitolo,
    popolaUrlSpotify,
    correggi,
};

if (require.main === module) {
    (async () => {
        console.log(
            APPLICA
                ? 'MODALITÀ: applicazione scritture'
                : 'MODALITÀ: sola anteprima, nessuna scrittura',
        );
        console.log('');

        const connessione = await pool.getConnection();
        try {
            const risultati = await correggi(
                connessione,
                RINOMINE_TITOLO,
                URL_SPOTIFY_BRANI,
                APPLICA,
            );
            console.table(risultati);
        } catch (errore) {
            console.error('Correzione fallita:', errore.message);
            process.exitCode = 1;
        } finally {
            connessione.release();
            await pool.end();
        }
    })();
}
