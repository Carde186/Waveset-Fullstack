// Popola brano.collaboratori per brani già presenti nel database (stesso
// principio "correzione di un dato già in DB è un'azione ADMIN a sé" di
// scripts/correggiLotto1.js — non un effetto collaterale dell'import
// principale, che non scrive mai in questa colonna). Anteprima di default,
// --applica per scrivere, ricontrollo a freddo immediatamente prima di
// ogni UPDATE, mai sovrascritto un valore già presente.
//
// Richiede prima lo schema di db/init/12_collaboratori_brano_schema.sql
// applicato (colonna brano.collaboratori) — finché non lo è, gli UPDATE
// falliscono su una colonna sconosciuta: segnale corretto, non un difetto
// di questo script.
//
// Sicurezza esplicita: se il nome del collaboratore compare già (anche
// come sottostringa, case-insensitive) nel titolo del brano, lo script SI
// FERMA con un errore invece di scrivere — evita di duplicare
// un'informazione già visibile nel titolo (es. mai "Con Sia" su "Titanium
// (feat. Sia)"). Questa colonna è pensata solo per il caso opposto: un
// collaboratore accreditato dalle piattaforme ma assente dal titolo.
//
// Uso:
//   node scripts/popolaCollaboratoriBrani.js            (anteprima, nessuna scrittura)
//   node scripts/popolaCollaboratoriBrani.js --applica  (applica le scritture)
require('dotenv').config();

const pool = require('../src/config/database');

const APPLICA = process.argv.includes('--applica');

// Voci verificate: nome del collaboratore assente dal titolo ufficiale sia
// su Spotify sia su Apple (a differenza di "Titanium (feat. Sia)", dove il
// titolo lo include già — quel brano non ha bisogno di questa colonna).
const COLLABORATORI = [
    {
        artistaNome: 'Martin Garrix',
        titolo: 'In the Name of Love',
        collaboratori: 'Bebe Rexha',
    },
    {
        // Spotify e Apple concordano: titolo "Marea (we've lost dancing)"
        // (nessun "feat."), The Blessed Madonna nell'array artisti di
        // Spotify e nel campo artistName di Apple ("Fred again.. & The
        // Blessed Madonna") — stesso caso di Bebe Rexha sopra, mai nel
        // titolo del brano.
        artistaNome: 'Fred again..',
        titolo: 'Marea (we’ve lost dancing)',
        collaboratori: 'The Blessed Madonna',
    },
];

async function trovaBranoUnivoco(connessione, artistaNome, titolo) {
    const [righe] = await connessione.query(
        `SELECT b.id, b.titolo, b.collaboratori
         FROM brano b
         INNER JOIN artista a ON a.id = b.artista_id
         WHERE a.nome = ? AND b.titolo = ?`,
        [artistaNome, titolo],
    );

    if (righe.length > 1) {
        throw new Error(
            `Più righe trovate per "${titolo}" di ${artistaNome}: non scelgo quale usare, va risolto a mano.`,
        );
    }

    return righe[0] ?? null;
}

async function popolaCollaboratori(connessione, voci, applica) {
    const risultati = [];

    for (const voce of voci) {
        const brano = await trovaBranoUnivoco(
            connessione,
            voce.artistaNome,
            voce.titolo,
        );

        if (!brano) {
            risultati.push({
                brano: `${voce.artistaNome} — ${voce.titolo}`,
                esito: 'brano non trovato nel database (non ancora importato)',
            });
            continue;
        }

        if (brano.collaboratori !== null) {
            risultati.push({
                brano: `${voce.artistaNome} — ${voce.titolo}`,
                esito: `già presente ("${brano.collaboratori}"), non sovrascritto`,
            });
            continue;
        }

        // Sicurezza anti-duplicazione: mai scrivere un collaboratore il
        // cui nome compare già nel titolo (ricontrollato qui, non solo
        // assunto dalla voce sopra).
        if (
            brano.titolo
                .toLowerCase()
                .includes(voce.collaboratori.toLowerCase())
        ) {
            throw new Error(
                `"${voce.collaboratori}" compare già nel titolo "${brano.titolo}": non scrivo un collaboratore duplicato. Correggi COLLABORATORI prima di rilanciare.`,
            );
        }

        if (!applica) {
            risultati.push({
                brano: `${voce.artistaNome} — ${voce.titolo}`,
                esito: `da scrivere: "${voce.collaboratori}" (anteprima)`,
            });
            continue;
        }

        // Ricontrollo a freddo immediatamente prima della scrittura:
        // rilegge la riga appena prima dell'UPDATE, non riusa lo stato
        // letto a inizio funzione (potrebbe essere cambiato se questo
        // script gira più volte di seguito nello stesso processo).
        const branoAFreddo = await trovaBranoUnivoco(
            connessione,
            voce.artistaNome,
            voce.titolo,
        );
        if (!branoAFreddo || branoAFreddo.collaboratori !== null) {
            risultati.push({
                brano: `${voce.artistaNome} — ${voce.titolo}`,
                esito: 'stato cambiato dal ricontrollo a freddo, saltato per sicurezza',
            });
            continue;
        }

        await connessione.query(
            'UPDATE brano SET collaboratori = ? WHERE id = ?',
            [voce.collaboratori, branoAFreddo.id],
        );
        risultati.push({
            brano: `${voce.artistaNome} — ${voce.titolo}`,
            esito: `scritto: "${voce.collaboratori}"`,
        });
    }

    return risultati;
}

module.exports = { COLLABORATORI, trovaBranoUnivoco, popolaCollaboratori };

// --solo-brano-id=<id>: filtra COLLABORATORI a una sola riga (per id
// LOCALE già inserito, risolto per chiave naturale come il resto dello
// script — mai un id passato alla cieca). Serve per autorizzare la
// scrittura di UNA riga specifica senza scrivere anche le altre voci
// eventualmente già presenti in COLLABORATORI (es. "In the Name of Love"
// di Martin Garrix, non ancora importato: senza questo filtro resterebbe
// "non trovato" oggi, ma diventerebbe scrivibile in automatico il giorno
// in cui il lotto 5 verrà applicato — mai senza un'autorizzazione esplicita
// per QUELLA riga in quel momento).
const ARG_SOLO_BRANO_ID = process.argv.find(a =>
    a.startsWith('--solo-brano-id='),
);
const SOLO_BRANO_ID = ARG_SOLO_BRANO_ID
    ? Number(ARG_SOLO_BRANO_ID.split('=')[1])
    : null;

async function filtraPerBranoId(connessione, voci, branoId) {
    const filtrate = [];
    for (const voce of voci) {
        const brano = await trovaBranoUnivoco(
            connessione,
            voce.artistaNome,
            voce.titolo,
        );
        if (brano && brano.id === branoId) {
            filtrate.push(voce);
        }
    }
    return filtrate;
}

if (require.main === module) {
    (async () => {
        console.log(
            APPLICA
                ? 'MODALITÀ: applicazione scritture'
                : 'MODALITÀ: sola anteprima, nessuna scrittura',
        );
        if (SOLO_BRANO_ID !== null) {
            console.log(`FILTRO: solo il brano con id locale ${SOLO_BRANO_ID}`);
        }
        console.log('');

        const connessione = await pool.getConnection();
        try {
            const voci =
                SOLO_BRANO_ID !== null
                    ? await filtraPerBranoId(
                          connessione,
                          COLLABORATORI,
                          SOLO_BRANO_ID,
                      )
                    : COLLABORATORI;

            if (SOLO_BRANO_ID !== null && voci.length === 0) {
                console.log(
                    `Nessuna voce di COLLABORATORI risolve all'id ${SOLO_BRANO_ID}: nulla da fare.`,
                );
                return;
            }

            const risultati = await popolaCollaboratori(
                connessione,
                voci,
                APPLICA,
            );
            console.table(risultati);
        } catch (errore) {
            console.error('Operazione fallita:', errore.message);
            process.exitCode = 1;
        } finally {
            connessione.release();
            await pool.end();
        }
    })();
}
