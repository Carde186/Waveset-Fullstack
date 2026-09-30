const pool = require('../config/database');
const servizioGeocodifica = require('../servizi/geocodifica');
const servizioTicketmaster = require('../servizi/ticketmaster');

// Chiamate come servizioX.funzione(...), non distrutte in una const al
// require: i test le sostituiscono con mock.method sull'oggetto esportato,
// che non avrebbe effetto su un riferimento a funzione già catturato prima
// del mock (vedi test/ticketmasterImporta.test.js).

// 5 richieste/secondo è il limite del piano gratuito self-service
// (Ticketmaster Developer Portal): 250ms tra un artista e l'altro resta
// ampiamente sotto soglia senza bisogno di un rate limiter vero.
const PAUSA_MS = 250;

function attendi(ms) {
    return new Promise(risolvi => setTimeout(risolvi, ms));
}

// Solo "HH:mm" o "HH:mm:ss": qualunque altra forma (inclusi i casi in cui
// Ticketmaster non fornisce affatto il local time) diventa NULL, mai
// interpretata o convertita — CLAUDE.md vieta esplicitamente conversioni di
// fuso su ora_evento.
function oraValida(valore) {
    if (typeof valore !== 'string') {
        return null;
    }
    if (/^\d{2}:\d{2}:\d{2}$/.test(valore)) {
        return valore;
    }
    if (/^\d{2}:\d{2}$/.test(valore)) {
        return `${valore}:00`;
    }
    return null;
}

function normalizzaNome(nome) {
    return nome.trim().toLowerCase();
}

// Attraction il cui nome combacia ESATTAMENTE (case-insensitive, trim) con
// un artista del catalogo — su QUALUNQUE subType. Non si filtra più per
// classifications[0].subType.name === 'Artist': un test con un artista
// reale (Carl Cox) ha mostrato che Ticketmaster lo classifica "Undefined",
// non "Artist" — quel filtro escludeva l'headliner stesso, non solo i nomi
// di festival che doveva escludere (vedi CLAUDE.md). Nessun'altra euristica
// oltre all'uguaglianza esatta: un match parziale/fuzzy rischierebbe di
// aggiungere al lineup un omonimo, o un nome combinato ("Carl Cox & Eric
// Powell") come se fosse un solo artista — l'uguaglianza esatta sull'intera
// stringa esclude già questo caso da sola, senza bisogno del subType.
function trovaArtistiCorrispondenti(evento, artistiPerNome) {
    const attractions = evento._embedded?.attractions ?? [];

    const corrispondenze = [];
    for (const attraction of attractions) {
        const artista = artistiPerNome.get(normalizzaNome(attraction.name));
        if (artista) {
            corrispondenze.push({ artista, idAttraction: attraction.id });
        }
    }

    return { attractions, corrispondenze };
}

async function risolviCoordinate(evento) {
    const venue = evento._embedded?.venues?.[0];
    const location = venue?.location;

    if (
        location?.latitude &&
        location.latitude !== '0.000000' &&
        location?.longitude &&
        location.longitude !== '0.000000'
    ) {
        return {
            latitudine: Number(location.latitude),
            longitudine: Number(location.longitude),
        };
    }

    if (!venue?.address?.line1 || !venue?.city?.name) {
        return { latitudine: null, longitudine: null };
    }

    const indirizzo = [
        venue.address.line1,
        venue.city.name,
        venue.country?.name,
    ]
        .filter(Boolean)
        .join(', ');

    const risultato = await servizioGeocodifica.geocodifica(indirizzo);
    return risultato ?? { latitudine: null, longitudine: null };
}

// Possibile doppione: un altro evento (qualunque fonte o stato, tranne
// quello che stiamo per inserire, che non esiste ancora) con almeno uno
// degli stessi artisti in lineup, stessa data, stesso luogo. Non basta per
// scartare: va comunque in coda, la decisione resta all'ADMIN (CLAUDE.md).
async function possibileDoppione(dataEvento, luogo, idArtisti) {
    if (!luogo || idArtisti.length === 0) {
        return false;
    }

    const [righe] = await pool.query(
        `SELECT 1 FROM evento e
         INNER JOIN evento_artista ea ON ea.evento_id = e.id
         WHERE e.data_evento = ? AND LOWER(e.luogo) = LOWER(?)
             AND ea.artista_id IN (?)
         LIMIT 1`,
        [dataEvento, luogo, idArtisti],
    );

    return righe.length > 0;
}

async function importaArtista(artista, artistiPerNome, riepilogo) {
    const eventi = await servizioTicketmaster.cercaEventi(
        artista.id_ticketmaster
            ? { attractionId: artista.id_ticketmaster }
            : { keyword: artista.nome },
    );

    for (const evento of eventi) {
        const idEsterno = evento.id;
        const [esistenti] = await pool.query(
            "SELECT 1 FROM evento WHERE fonte = 'ticketmaster' AND id_esterno = ?",
            [idEsterno],
        );

        // Già importato in un giro precedente: non si tocca, qualunque sia
        // il suo stato oggi (anche se scartato o corretto a mano
        // dall'ADMIN) — vedi CLAUDE.md, import non deve mai annullare una
        // decisione già presa.
        if (esistenti.length > 0) {
            riepilogo.saltati += 1;
            continue;
        }

        const dataEvento = evento.dates?.start?.localDate ?? null;
        if (!dataEvento) {
            riepilogo.senzaData += 1;
            continue;
        }

        const oraEvento = oraValida(evento.dates?.start?.localTime);
        const venue = evento._embedded?.venues?.[0];
        const luogo = venue?.name ?? null;
        const citta = venue?.city?.name ?? null;
        const { latitudine, longitudine } = await risolviCoordinate(evento);

        const { corrispondenze } = trovaArtistiCorrispondenti(
            evento,
            artistiPerNome,
        );
        const ricercanteConfermato = corrispondenze.some(
            c => c.artista.id === artista.id,
        );

        const motivi = [];

        if (latitudine === null || longitudine === null) {
            motivi.push('coordinate_irrecuperabili');
        }
        if (corrispondenze.length === 0) {
            motivi.push('nessuna_attraction_riconosciuta');
        } else if (!ricercanteConfermato) {
            motivi.push('lineup_non_confermato');
        }
        // Solo per ricerche per nome: una ricerca per attractionId è già
        // stata confermata dall'ADMIN in precedenza, non richiede una
        // seconda conferma.
        if (!artista.id_ticketmaster && ricercanteConfermato) {
            motivi.push('id_artista_da_confermare');
        }
        if (
            await possibileDoppione(
                dataEvento,
                luogo,
                corrispondenze.map(c => c.artista.id),
            )
        ) {
            motivi.push('possibile_doppione');
        }

        const stato = motivi.length > 0 ? 'in_coda' : 'pubblicato';

        const [risultato] = await pool.query(
            `INSERT INTO evento
                (titolo, data_evento, ora_evento, luogo, citta, latitudine,
                 longitudine, fonte, id_esterno, stato, motivo_revisione)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'ticketmaster', ?, ?, ?)`,
            [
                evento.name,
                dataEvento,
                oraEvento,
                luogo,
                citta,
                latitudine,
                longitudine,
                idEsterno,
                stato,
                motivi.length > 0 ? motivi.join('; ') : null,
            ],
        );

        for (const { artista: artistaLineup, idAttraction } of corrispondenze) {
            await pool.query(
                `INSERT INTO evento_artista (evento_id, artista_id, id_attraction_ticketmaster)
                 VALUES (?, ?, ?)`,
                [risultato.insertId, artistaLineup.id, idAttraction],
            );
        }

        riepilogo[stato === 'pubblicato' ? 'pubblicati' : 'inCoda'] += 1;
    }
}

// Punto d'ingresso unico, usato dallo script CLI (scripts/importaTicketmaster.js)
// e dai test. Avvio manuale per scelta (CLAUDE.md): nessuno scheduler
// interno al processo Express, coerente con il seed Spotify "una tantum".
async function importaEventi() {
    const [artisti] = await pool.query(
        'SELECT id, nome, id_ticketmaster FROM artista',
    );
    const artistiPerNome = new Map(
        artisti.map(a => [normalizzaNome(a.nome), a]),
    );

    const riepilogo = {
        pubblicati: 0,
        inCoda: 0,
        saltati: 0,
        senzaData: 0,
    };

    for (const [indice, artista] of artisti.entries()) {
        await importaArtista(artista, artistiPerNome, riepilogo);
        if (indice < artisti.length - 1) {
            await attendi(PAUSA_MS);
        }
    }

    return riepilogo;
}

module.exports = {
    importaEventi,
    // Esportate anche per il ricalcolo una tantum degli eventi già importati
    // (scripts/ricalcolaLineupEventiEsistenti.js): stessa regola di
    // matching, un solo punto in cui è definita.
    normalizzaNome,
    trovaArtistiCorrispondenti,
};
