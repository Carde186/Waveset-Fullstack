// Logica di importazione (src/ticketmaster/importa.js): i servizi esterni
// (Ticketmaster, Google Geocoding) sono sostituiti con mock.method di
// node:test, restituiti dai fixture qui sotto — nessuna chiamata di rete
// vera, nessuna chiave API richiesta per lanciare questi test. Il resto
// (query, inserimenti, join) gira contro il database reale di sviluppo,
// come tutti gli altri test di integrazione del progetto.
//
// A differenza degli altri file di test, qui si richiede src/ticketmaster/
// importa.js dentro al processo di test (per poterne mockare le dipendenze
// con mock.method): usa quindi il pool di connessione dell'app
// (src/config/database.js), che legge DB_HOST dal .env — "mysql", il nome
// del servizio Docker, risolvibile solo dentro la rete di Compose. Stessa
// ragione per cui aiuto.js usa 127.0.0.1 per il proprio pool: da qui,
// bisogna forzarlo PRIMA che config/database.js crei il pool (a livello di
// modulo, la prima volta che viene richiesto in tutto il processo).
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, describe, test } = require('node:test');

const { db, chiudi } = require('./aiuto');

const poolApp = require('../src/config/database');
const servizioTicketmaster = require('../src/servizi/ticketmaster');
const servizioGeocodifica = require('../src/servizi/geocodifica');
const { importaEventi } = require('../src/ticketmaster/importa');

// Artisti del seed (06_eventi_seed.sql / 01_schema.sql): niente id fisso
// inventato, li leggiamo per non dipendere da un ordine di inserimento che
// potrebbe cambiare.
let novaCircuit;
let sunsetGrid;
let lucentWave;

const PREFISSO = 'TM test: ';
const idArtistiToccati = new Set();

before(async () => {
    const [righe] = await db.query(
        "SELECT id, nome FROM artista WHERE nome IN ('Nova Circuit', 'Sunset Grid', 'Lucent Wave')",
    );
    novaCircuit = righe.find(a => a.nome === 'Nova Circuit');
    sunsetGrid = righe.find(a => a.nome === 'Sunset Grid');
    lucentWave = righe.find(a => a.nome === 'Lucent Wave');
});

after(async () => {
    // FK ON DELETE CASCADE su evento_artista: basta cancellare l'evento.
    await db.query('DELETE FROM evento WHERE titolo LIKE ?', [`${PREFISSO}%`]);
    if (idArtistiToccati.size > 0) {
        await db.query(
            'UPDATE artista SET id_ticketmaster = NULL WHERE id IN (?)',
            [[...idArtistiToccati]],
        );
    }
    await chiudi();
    // Pool separato (src/config/database.js, usato da importaEventi tramite
    // require diretto): chiudi() di aiuto.js chiude solo il proprio.
    await poolApp.end();
});

function eventoFixture({
    nomeArtista = 'Nova Circuit',
    titolo = 'Evento di prova',
    data = '2028-01-01',
    ora = '21:00:00',
    venue = {},
    attractions,
} = {}) {
    return {
        id: crypto.randomUUID(),
        name: `${PREFISSO}${titolo}`,
        dates: { start: { localDate: data, localTime: ora } },
        _embedded: {
            venues: [
                {
                    name: 'Venue di prova',
                    city: { name: 'Città di prova' },
                    address: { line1: 'Via di prova 1' },
                    country: { name: 'Italia' },
                    location: { latitude: '45.000000', longitude: '9.000000' },
                    ...venue,
                },
            ],
            // subType 'Undefined' di default, non 'Artist': è quello che
            // restituisce davvero Ticketmaster per un artista headliner
            // reale (verificato con Carl Cox) — il fixture di base riflette
            // il caso comune, non quello raro.
            attractions: attractions ?? [
                {
                    id: `attraction-${nomeArtista}`,
                    name: nomeArtista,
                    classifications: [{ subType: { name: 'Undefined' } }],
                },
            ],
        },
    };
}

// Mocka cercaEventi in modo che risponda solo per l'artista bersaglio del
// test (keyword o attractionId), vuoto per tutti gli altri artisti del
// catalogo: importaEventi() gira comunque su tutti e quattro ad ogni turno.
function mockaRicerca(t, { perKeyword, perAttractionId } = {}) {
    return t.mock.method(
        servizioTicketmaster,
        'cercaEventi',
        async ({ keyword, attractionId }) => {
            if (
                attractionId &&
                perAttractionId &&
                attractionId === perAttractionId.id
            ) {
                return perAttractionId.eventi;
            }
            if (keyword && perKeyword && keyword === perKeyword.nome) {
                return perKeyword.eventi;
            }
            return [];
        },
    );
}

describe('importaEventi — casi puliti', () => {
    test('prima ricerca per nome: anche se tutto combacia, va in coda per conferma id artista', async t => {
        mockaRicerca(t, {
            perKeyword: {
                nome: 'Nova Circuit',
                eventi: [eventoFixture({ titolo: 'Prima associazione' })],
            },
        });

        const riepilogo = await importaEventi();
        assert.equal(riepilogo.inCoda, 1);
        assert.equal(riepilogo.pubblicati, 0);

        const [[evento]] = await db.query(
            'SELECT stato, motivo_revisione FROM evento WHERE titolo = ?',
            [`${PREFISSO}Prima associazione`],
        );
        assert.equal(evento.stato, 'in_coda');
        assert.equal(evento.motivo_revisione, 'id_artista_da_confermare');
    });

    test('ricerca per attractionId (artista già confermato): pubblicato subito', async t => {
        await db.query('UPDATE artista SET id_ticketmaster = ? WHERE id = ?', [
            'attraction-confermato-sunset',
            sunsetGrid.id,
        ]);
        idArtistiToccati.add(sunsetGrid.id);

        mockaRicerca(t, {
            perAttractionId: {
                id: 'attraction-confermato-sunset',
                eventi: [
                    eventoFixture({
                        nomeArtista: 'Sunset Grid',
                        titolo: 'Via attractionId',
                    }),
                ],
            },
        });

        const riepilogo = await importaEventi();
        assert.equal(riepilogo.pubblicati, 1);

        const [[evento]] = await db.query(
            'SELECT stato, motivo_revisione, fonte, id_esterno FROM evento WHERE titolo = ?',
            [`${PREFISSO}Via attractionId`],
        );
        assert.equal(evento.stato, 'pubblicato');
        assert.equal(evento.motivo_revisione, null);
        assert.equal(evento.fonte, 'ticketmaster');
    });
});

describe('importaEventi — matching per nome esatto, senza fidarsi del subType', () => {
    test("subType 'Undefined' (come Carl Cox su dati reali): combacia comunque", async t => {
        mockaRicerca(t, {
            perKeyword: {
                nome: 'Nova Circuit',
                eventi: [
                    eventoFixture({
                        titolo: 'Match con subType Undefined',
                        data: '2028-04-01',
                        attractions: [
                            {
                                id: 'attraction-nova-undefined',
                                name: 'Nova Circuit',
                                classifications: [
                                    { subType: { name: 'Undefined' } },
                                ],
                            },
                        ],
                    }),
                ],
            },
        });

        await importaEventi();

        const [[evento]] = await db.query(
            'SELECT motivo_revisione FROM evento WHERE titolo = ?',
            [`${PREFISSO}Match con subType Undefined`],
        );
        // id_artista_da_confermare è atteso (prima ricerca per nome per
        // Nova Circuit): quello che NON deve più comparire è un motivo di
        // mancato riconoscimento del lineup.
        assert.doesNotMatch(
            evento.motivo_revisione ?? '',
            /nessuna_attraction_riconosciuta|lineup_non_confermato/,
        );

        const [righeLineup] = await db.query(
            `SELECT a.nome FROM evento_artista ea
             INNER JOIN artista a ON a.id = ea.artista_id
             INNER JOIN evento e ON e.id = ea.evento_id
             WHERE e.titolo = ?`,
            [`${PREFISSO}Match con subType Undefined`],
        );
        assert.deepEqual(
            righeLineup.map(r => r.nome),
            ['Nova Circuit'],
        );
    });

    test("subType 'Musician' per un secondo artista del catalogo: combacia comunque", async t => {
        mockaRicerca(t, {
            perAttractionId: {
                id: 'attraction-confermato-sunset',
                eventi: [
                    eventoFixture({
                        nomeArtista: 'Sunset Grid',
                        titolo: 'Due artisti, subType diversi',
                        data: '2028-04-02',
                        attractions: [
                            {
                                id: 'attraction-confermato-sunset',
                                name: 'Sunset Grid',
                                classifications: [
                                    { subType: { name: 'Undefined' } },
                                ],
                            },
                            {
                                id: 'attraction-lucent-musician',
                                name: 'Lucent Wave',
                                classifications: [
                                    { subType: { name: 'Musician' } },
                                ],
                            },
                        ],
                    }),
                ],
            },
        });

        await importaEventi();

        const [righeLineup] = await db.query(
            `SELECT a.nome FROM evento_artista ea
             INNER JOIN artista a ON a.id = ea.artista_id
             INNER JOIN evento e ON e.id = ea.evento_id
             WHERE e.titolo = ?
             ORDER BY a.nome`,
            [`${PREFISSO}Due artisti, subType diversi`],
        );
        assert.deepEqual(
            righeLineup.map(r => r.nome),
            ['Lucent Wave', 'Sunset Grid'],
        );
    });

    test('nome combinato ("X & Y"), classifications assente: non combacia con nessuno dei due', async t => {
        mockaRicerca(t, {
            perKeyword: {
                nome: 'Nova Circuit',
                eventi: [
                    eventoFixture({
                        titolo: 'Nome combinato',
                        data: '2028-04-03',
                        attractions: [
                            {
                                id: 'attraction-combinata',
                                name: 'Nova Circuit & Lucent Wave',
                                // Visto sui dati reali (Carl Cox & Eric
                                // Powell): nessun campo classifications.
                            },
                        ],
                    }),
                ],
            },
        });

        await importaEventi();

        const [[evento]] = await db.query(
            'SELECT motivo_revisione FROM evento WHERE titolo = ?',
            [`${PREFISSO}Nome combinato`],
        );
        assert.equal(
            evento.motivo_revisione,
            'nessuna_attraction_riconosciuta',
        );

        const [righeLineup] = await db.query(
            `SELECT a.nome FROM evento_artista ea
             INNER JOIN artista a ON a.id = ea.artista_id
             INNER JOIN evento e ON e.id = ea.evento_id
             WHERE e.titolo = ?`,
            [`${PREFISSO}Nome combinato`],
        );
        assert.deepEqual(righeLineup, []);
    });
});

describe('importaEventi — motivi di coda', () => {
    test('coordinate 0.000000 e geocodifica riuscita: pubblicato con le coordinate geocodificate', async t => {
        await db.query('UPDATE artista SET id_ticketmaster = ? WHERE id = ?', [
            'attraction-geo-ok',
            lucentWave.id,
        ]);
        idArtistiToccati.add(lucentWave.id);

        mockaRicerca(t, {
            perAttractionId: {
                id: 'attraction-geo-ok',
                eventi: [
                    eventoFixture({
                        nomeArtista: 'Lucent Wave',
                        titolo: 'Coordinate da geocodifica',
                        venue: {
                            location: {
                                latitude: '0.000000',
                                longitude: '0.000000',
                            },
                        },
                    }),
                ],
            },
        });
        t.mock.method(servizioGeocodifica, 'geocodifica', async () => ({
            latitudine: 41.9,
            longitudine: 12.5,
        }));

        await importaEventi();

        const [[evento]] = await db.query(
            'SELECT stato, latitudine, longitudine FROM evento WHERE titolo = ?',
            [`${PREFISSO}Coordinate da geocodifica`],
        );
        assert.equal(evento.stato, 'pubblicato');
        assert.equal(Number(evento.latitudine), 41.9);
        assert.equal(Number(evento.longitudine), 12.5);
    });

    test('coordinate 0.000000 e geocodifica fallita: in coda per coordinate irrecuperabili', async t => {
        await db.query('UPDATE artista SET id_ticketmaster = ? WHERE id = ?', [
            'attraction-geo-fail',
            lucentWave.id,
        ]);
        idArtistiToccati.add(lucentWave.id);

        mockaRicerca(t, {
            perAttractionId: {
                id: 'attraction-geo-fail',
                eventi: [
                    eventoFixture({
                        nomeArtista: 'Lucent Wave',
                        titolo: 'Coordinate irrecuperabili',
                        data: '2028-01-02',
                        venue: {
                            name: 'Altro venue',
                            location: {
                                latitude: '0.000000',
                                longitude: '0.000000',
                            },
                        },
                    }),
                ],
            },
        });
        t.mock.method(servizioGeocodifica, 'geocodifica', async () => null);

        await importaEventi();

        const [[evento]] = await db.query(
            'SELECT stato, motivo_revisione, latitudine FROM evento WHERE titolo = ?',
            [`${PREFISSO}Coordinate irrecuperabili`],
        );
        assert.equal(evento.stato, 'in_coda');
        assert.equal(evento.motivo_revisione, 'coordinate_irrecuperabili');
        assert.equal(evento.latitudine, null);
    });

    test('nessuna attraction combacia con un nome del catalogo: nessuna_attraction_riconosciuta', async t => {
        mockaRicerca(t, {
            perKeyword: {
                nome: 'Nova Circuit',
                eventi: [
                    eventoFixture({
                        titolo: 'Nessun match',
                        attractions: [
                            {
                                id: 'festival-x',
                                name: 'Festival X',
                                classifications: [
                                    { subType: { name: 'Festival' } },
                                ],
                            },
                            {
                                id: 'omonimo',
                                // Nome vicino ma non identico: l'uguaglianza
                                // resta esatta, non un match parziale.
                                name: 'Nova Circuit Tribute',
                                classifications: [
                                    { subType: { name: 'Undefined' } },
                                ],
                            },
                        ],
                    }),
                ],
            },
        });

        await importaEventi();

        const [[evento]] = await db.query(
            'SELECT stato, motivo_revisione FROM evento WHERE titolo = ?',
            [`${PREFISSO}Nessun match`],
        );
        assert.equal(evento.stato, 'in_coda');
        assert.equal(
            evento.motivo_revisione,
            'nessuna_attraction_riconosciuta',
        );
    });

    test('un altro artista del catalogo combacia, ma non quello cercato: lineup non confermato', async t => {
        mockaRicerca(t, {
            perKeyword: {
                nome: 'Nova Circuit',
                eventi: [
                    eventoFixture({
                        titolo: 'Lineup non confermato',
                        data: '2028-04-04',
                        attractions: [
                            {
                                id: 'attraction-lucent',
                                // Combacia con un artista DIVERSO del
                                // catalogo, non con quello che ha avviato la
                                // ricerca (Nova Circuit non compare affatto).
                                name: 'Lucent Wave',
                                classifications: [
                                    { subType: { name: 'Undefined' } },
                                ],
                            },
                        ],
                    }),
                ],
            },
        });

        await importaEventi();

        const [[evento]] = await db.query(
            'SELECT stato, motivo_revisione FROM evento WHERE titolo = ?',
            [`${PREFISSO}Lineup non confermato`],
        );
        assert.equal(evento.stato, 'in_coda');
        assert.equal(evento.motivo_revisione, 'lineup_non_confermato');

        const [righeLineup] = await db.query(
            `SELECT a.nome FROM evento_artista ea
             INNER JOIN artista a ON a.id = ea.artista_id
             INNER JOIN evento e ON e.id = ea.evento_id
             WHERE e.titolo = ?`,
            [`${PREFISSO}Lineup non confermato`],
        );
        // Lucent Wave combacia per nome esatto e finisce comunque in
        // lineup: il motivo riguarda solo la conferma dell'artista
        // cercante, non impedisce di registrare un match valido diverso.
        assert.deepEqual(
            righeLineup.map(r => r.nome),
            ['Lucent Wave'],
        );
    });

    test('possibile doppione: stesso artista, stessa data, stesso luogo, id_esterno diverso', async t => {
        await db.query('UPDATE artista SET id_ticketmaster = ? WHERE id = ?', [
            'attraction-doppione',
            novaCircuit.id,
        ]);
        idArtistiToccati.add(novaCircuit.id);

        // Evento "rivenditore A" già pubblicato a mano.
        const [risultato] = await db.query(
            `INSERT INTO evento (titolo, data_evento, luogo, citta)
             VALUES (?, '2028-02-02', 'Stesso Venue', 'Stessa Città')`,
            [`${PREFISSO}Doppione manuale`],
        );
        await db.query(
            'INSERT INTO evento_artista (evento_id, artista_id) VALUES (?, ?)',
            [risultato.insertId, novaCircuit.id],
        );

        mockaRicerca(t, {
            perAttractionId: {
                id: 'attraction-doppione',
                eventi: [
                    eventoFixture({
                        nomeArtista: 'Nova Circuit',
                        titolo: 'Doppione da Ticketmaster',
                        data: '2028-02-02',
                        venue: { name: 'Stesso Venue' },
                    }),
                ],
            },
        });

        await importaEventi();

        const [[evento]] = await db.query(
            'SELECT stato, motivo_revisione FROM evento WHERE titolo = ?',
            [`${PREFISSO}Doppione da Ticketmaster`],
        );
        assert.equal(evento.stato, 'in_coda');
        assert.match(evento.motivo_revisione, /possibile_doppione/);
    });
});

describe('importaEventi — non annulla mai una decisione già presa', () => {
    test('un id_esterno già importato non viene ritoccato, qualunque sia il suo stato', async t => {
        await db.query('UPDATE artista SET id_ticketmaster = ? WHERE id = ?', [
            'attraction-idempotenza',
            sunsetGrid.id,
        ]);
        idArtistiToccati.add(sunsetGrid.id);

        const fixture = eventoFixture({
            nomeArtista: 'Sunset Grid',
            titolo: 'Non toccare',
        });
        mockaRicerca(t, {
            perAttractionId: {
                id: 'attraction-idempotenza',
                eventi: [fixture],
            },
        });

        await importaEventi();
        // L'ADMIN scarta l'evento a mano (simulato con un UPDATE diretto,
        // come farebbe l'endpoint POST .../scarta).
        await db.query(
            "UPDATE evento SET stato = 'scartato' WHERE titolo = ?",
            [`${PREFISSO}Non toccare`],
        );

        const riepilogo = await importaEventi();
        assert.equal(riepilogo.saltati, 1);

        const [[evento]] = await db.query(
            'SELECT stato FROM evento WHERE titolo = ?',
            [`${PREFISSO}Non toccare`],
        );
        assert.equal(evento.stato, 'scartato');
    });
});
