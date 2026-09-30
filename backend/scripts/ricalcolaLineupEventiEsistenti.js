// Script una tantum, SEPARATO dal flusso di import normale
// (scripts/importaTicketmaster.js non lo richiama e non cambia il suo
// comportamento): ricalcola il lineup dei soli eventi elencati sotto,
// importati prima della correzione della regola di matching (non si fidava
// più solo di subType.name === 'Artist', vedi CLAUDE.md e
// src/ticketmaster/importa.js).
//
// Uso:
//   node scripts/ricalcolaLineupEventiEsistenti.js            (anteprima, nessuna scrittura)
//   node scripts/ricalcolaLineupEventiEsistenti.js --applica  (applica le modifiche)
require('dotenv').config();

const pool = require('../src/config/database');
const servizioTicketmaster = require('../src/servizi/ticketmaster');
const {
    normalizzaNome,
    trovaArtistiCorrispondenti,
} = require('../src/ticketmaster/importa');

// Id di evento trovati durante il test reale con l'artista temporaneo Carl
// Cox (id 13): lista esplicita, non un criterio generico, apposta per non
// toccare nessun altro evento, presente o futuro.
const ID_EVENTI_DA_RICALCOLARE = [121, 122, 123, 124, 125, 126, 127, 128, 129];
const ARTISTA_RICERCANTE_ID = 13; // Carl Cox: l'artista con cui sono stati trovati.

// Motivi che dipendono dal lineup: sostituiti dal ricalcolo. Gli altri
// (coordinate_irrecuperabili, possibile_doppione), se presenti, restano
// intatti — questo script non ricalcola coordinate né doppioni.
const MOTIVI_LINEUP = new Set([
    'lineup_ambiguo', // etichetta precedente alla correzione
    'nessuna_attraction_riconosciuta',
    'lineup_non_confermato',
    'id_artista_da_confermare',
]);

const APPLICA = process.argv.includes('--applica');

function motiviPreservati(motivoRevisione) {
    if (!motivoRevisione) {
        return [];
    }
    return motivoRevisione
        .split(';')
        .map(m => m.trim())
        .filter(m => m && !MOTIVI_LINEUP.has(m));
}

async function calcolaNuovoLineup(evento, artista, artistiPerNome) {
    const dettaglio = await servizioTicketmaster.recuperaEvento(
        evento.id_esterno,
    );

    if (!dettaglio) {
        return {
            anomalia:
                'Ticketmaster non ha restituito questo evento (rimosso o scaduto)',
        };
    }
    if (dettaglio.id !== evento.id_esterno) {
        return {
            anomalia: `id_esterno non corrisponde: atteso ${evento.id_esterno}, ricevuto ${dettaglio.id}`,
        };
    }

    const { corrispondenze } = trovaArtistiCorrispondenti(
        dettaglio,
        artistiPerNome,
    );
    const ricercanteConfermato = corrispondenze.some(
        c => c.artista.id === artista.id,
    );

    const nuoviMotiviLineup = [];
    if (corrispondenze.length === 0) {
        nuoviMotiviLineup.push('nessuna_attraction_riconosciuta');
    } else if (!ricercanteConfermato) {
        nuoviMotiviLineup.push('lineup_non_confermato');
    }
    if (!artista.id_ticketmaster && ricercanteConfermato) {
        nuoviMotiviLineup.push('id_artista_da_confermare');
    }

    return { corrispondenze, nuoviMotiviLineup };
}

async function elaboraEvento(id, artista, artistiPerNome, applica) {
    const [righe] = await pool.query('SELECT * FROM evento WHERE id = ?', [id]);
    const evento = righe[0];

    if (!evento) {
        return {
            id,
            esito: 'saltato',
            motivo: 'evento non trovato nel database',
        };
    }
    if (evento.fonte !== 'ticketmaster' || !evento.id_esterno) {
        return {
            id,
            esito: 'saltato',
            motivo: `fonte/id_esterno inattesi (fonte=${evento.fonte})`,
        };
    }
    if (evento.stato !== 'in_coda') {
        return {
            id,
            esito: 'saltato',
            motivo: `stato non più in_coda (attuale: ${evento.stato}) — decisione ADMIN già presa, non si tocca`,
        };
    }

    const [lineupEsistente] = await pool.query(
        'SELECT 1 FROM evento_artista WHERE evento_id = ? LIMIT 1',
        [id],
    );
    if (lineupEsistente.length > 0) {
        return {
            id,
            esito: 'saltato',
            motivo: 'lineup già presente (già modificata) — non si tocca',
        };
    }

    let risultato;
    try {
        risultato = await calcolaNuovoLineup(evento, artista, artistiPerNome);
    } catch (errore) {
        return {
            id,
            esito: 'saltato',
            motivo: `errore Ticketmaster: ${errore.message}`,
        };
    }

    if (risultato.anomalia) {
        return { id, esito: 'saltato', motivo: risultato.anomalia };
    }

    const { corrispondenze, nuoviMotiviLineup } = risultato;
    const motivoFinale =
        [
            ...motiviPreservati(evento.motivo_revisione),
            ...nuoviMotiviLineup,
        ].join('; ') || null;

    const riepilogo = {
        id,
        esito: applica ? 'applicato' : 'anteprima',
        titolo: evento.titolo,
        motivo_prima: evento.motivo_revisione,
        motivo_dopo: motivoFinale,
        lineup_da_aggiungere: corrispondenze.map(c => c.artista.nome),
    };

    if (!applica) {
        return riepilogo;
    }

    // Ricontrollo a freddo, immediatamente prima di scrivere: lo stato
    // potrebbe essere cambiato tra l'anteprima e l'applicazione (un ADMIN
    // potrebbe aver agito nel frattempo).
    const [[eventoFresco]] = await pool.query(
        'SELECT stato, id_esterno FROM evento WHERE id = ?',
        [id],
    );
    const [lineupFresco] = await pool.query(
        'SELECT 1 FROM evento_artista WHERE evento_id = ? LIMIT 1',
        [id],
    );
    if (
        !eventoFresco ||
        eventoFresco.stato !== 'in_coda' ||
        lineupFresco.length > 0 ||
        eventoFresco.id_esterno !== evento.id_esterno
    ) {
        return {
            id,
            esito: 'saltato',
            motivo: 'stato cambiato tra anteprima e applicazione — non si tocca',
        };
    }

    const connessione = await pool.getConnection();
    try {
        await connessione.beginTransaction();
        for (const { artista: artistaLineup, idAttraction } of corrispondenze) {
            await connessione.query(
                `INSERT INTO evento_artista (evento_id, artista_id, id_attraction_ticketmaster)
                 VALUES (?, ?, ?)`,
                [id, artistaLineup.id, idAttraction],
            );
        }
        await connessione.query(
            'UPDATE evento SET motivo_revisione = ? WHERE id = ?',
            [motivoFinale, id],
        );
        await connessione.commit();
    } catch (errore) {
        await connessione.rollback();
        riepilogo.esito = 'errore';
        riepilogo.errore = errore.message;
    } finally {
        connessione.release();
    }

    return riepilogo;
}

async function main() {
    const [artisti] = await pool.query(
        'SELECT id, nome, id_ticketmaster FROM artista',
    );
    const artistiPerNome = new Map(
        artisti.map(a => [normalizzaNome(a.nome), a]),
    );
    const artistaRicercante = artisti.find(a => a.id === ARTISTA_RICERCANTE_ID);

    if (!artistaRicercante) {
        console.error(
            `Artista id ${ARTISTA_RICERCANTE_ID} non trovato: interrompo senza scrivere nulla.`,
        );
        await pool.end();
        process.exitCode = 1;
        return;
    }

    console.log(
        APPLICA
            ? 'MODALITÀ: applicazione scritture'
            : 'MODALITÀ: sola anteprima, nessuna scrittura',
    );
    console.log('');

    const risultati = [];
    for (const [indice, id] of ID_EVENTI_DA_RICALCOLARE.entries()) {
        const risultato = await elaboraEvento(
            id,
            artistaRicercante,
            artistiPerNome,
            APPLICA,
        );
        risultati.push(risultato);
        if (indice < ID_EVENTI_DA_RICALCOLARE.length - 1) {
            await new Promise(res => setTimeout(res, 250));
        }
    }

    console.table(
        risultati.map(r => ({
            id: r.id,
            esito: r.esito,
            titolo: r.titolo ?? '',
            motivo_prima: r.motivo_prima ?? r.motivo ?? '',
            motivo_dopo: r.motivo_dopo ?? '',
            lineup_da_aggiungere: (r.lineup_da_aggiungere ?? []).join(', '),
        })),
    );

    await pool.end();
}

main();
