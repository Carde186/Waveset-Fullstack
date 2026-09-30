// Endpoint /api/admin/eventi/*: coda di revisione, correzioni, approvazione,
// scarto, conferma del collegamento artista↔attraction. Protezione di
// ruolo (403 per USER, 401 per anonimi) e la regola "un evento senza
// coordinate non si approva". Gli eventi di prova si inseriscono
// direttamente nel database (già con fonte='ticketmaster'), non tramite
// l'import: qui si testano solo gli endpoint, l'import ha i suoi test in
// ticketmasterImporta.test.js.

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const {
    db,
    UTENTE_A,
    UTENTE_ADMIN,
    chiama,
    accedi,
    chiudi,
} = require('./aiuto');

const PREFISSO = 'Admin test: ';

let admin;
let utenteA;
let novaCircuit;
// Artista dedicato al test "conferma poi approva" (vedi describe più sotto):
// mai novaCircuit né altri artisti del seed, per non lasciare stato residuo
// su dati condivisi con gli altri file di test.
let artistaProva;

async function creaEventoInCoda({
    titolo,
    idEsterno,
    latitudine = 45.0,
    longitudine = 9.0,
    motivo = 'lineup_non_confermato',
    idAttractionCandidato = null,
    // Di default novaCircuit, come già in ogni test esistente: valutato ad
    // ogni chiamata (non al momento della definizione), quindi vede sempre
    // il valore assegnato in before().
    artistaId = novaCircuit.id,
} = {}) {
    const [risultato] = await db.query(
        `INSERT INTO evento
            (titolo, data_evento, luogo, citta, latitudine, longitudine,
             fonte, id_esterno, stato, motivo_revisione)
         VALUES (?, '2028-06-01', 'Venue', 'Città', ?, ?, 'ticketmaster', ?, 'in_coda', ?)`,
        [`${PREFISSO}${titolo}`, latitudine, longitudine, idEsterno, motivo],
    );
    await db.query(
        `INSERT INTO evento_artista (evento_id, artista_id, id_attraction_ticketmaster)
         VALUES (?, ?, ?)`,
        [risultato.insertId, artistaId, idAttractionCandidato],
    );
    return risultato.insertId;
}

before(async () => {
    admin = await accedi(UTENTE_ADMIN);
    utenteA = await accedi(UTENTE_A);
    const [[artista]] = await db.query(
        "SELECT id FROM artista WHERE nome = 'Nova Circuit'",
    );
    novaCircuit = artista;

    const [risultatoArtistaProva] = await db.query(
        `INSERT INTO artista (nome, bio)
         VALUES (?, 'Creato solo per adminEventi.test.js, cancellato in after()')`,
        [`${PREFISSO}artista di prova`],
    );
    artistaProva = { id: risultatoArtistaProva.insertId };
});

after(async () => {
    // L'evento va cancellato prima dell'artista di prova: la riga
    // evento_artista sparisce già in cascata da qui (FK ON DELETE CASCADE),
    // così la DELETE sull'artista sotto non trova più nulla da cascatare.
    await db.query('DELETE FROM evento WHERE titolo LIKE ?', [`${PREFISSO}%`]);
    await db.query('UPDATE artista SET id_ticketmaster = NULL WHERE id = ?', [
        novaCircuit.id,
    ]);
    await db.query('DELETE FROM artista WHERE id = ?', [artistaProva.id]);
    await chiudi();
});

describe('protezione di ruolo', () => {
    test('senza sessione: 401', async () => {
        assert.equal((await chiama('/admin/eventi/coda')).stato, 401);
    });

    test('utente non ADMIN: 403', async () => {
        const { stato } = await chiama('/admin/eventi/coda', {
            sessione: utenteA,
        });
        assert.equal(stato, 403);
    });
});

describe('coda eventi', () => {
    test('elenca solo gli eventi in coda, con lineup e motivo', async () => {
        const id = await creaEventoInCoda({
            titolo: 'In coda',
            idEsterno: `admin-test-${Date.now()}-a`,
        });

        const { stato, dati } = await chiama('/admin/eventi/coda', {
            sessione: admin,
        });

        assert.equal(stato, 200);
        const evento = dati.find(e => e.id === id);
        assert.ok(evento, 'evento creato non trovato nella coda');
        assert.equal(evento.motivo_revisione, 'lineup_non_confermato');
        assert.deepEqual(
            evento.lineup.map(a => a.nome),
            ['Nova Circuit'],
        );
    });

    test('dettaglio di un evento in coda', async () => {
        const id = await creaEventoInCoda({
            titolo: 'Dettaglio coda',
            idEsterno: `admin-test-${Date.now()}-i`,
        });

        const { stato, dati } = await chiama(`/admin/eventi/coda/${id}`, {
            sessione: admin,
        });
        assert.equal(stato, 200);
        assert.equal(dati.id, id);
        assert.equal(dati.lineup.length, 1);
    });

    test('dettaglio di un evento non in coda: 404', async () => {
        const { stato } = await chiama('/admin/eventi/coda/1', {
            sessione: admin,
        });
        assert.equal(stato, 404);
    });
});

describe('correzione', () => {
    test('PATCH aggiorna solo i campi consentiti', async () => {
        const id = await creaEventoInCoda({
            titolo: 'Da correggere',
            idEsterno: `admin-test-${Date.now()}-b`,
            latitudine: null,
            longitudine: null,
        });

        const { stato } = await chiama(`/admin/eventi/${id}`, {
            metodo: 'PATCH',
            sessione: admin,
            corpo: { latitudine: 41.9, longitudine: 12.5, luogo: 'Corretto' },
        });
        assert.equal(stato, 204);

        const [[evento]] = await db.query(
            'SELECT latitudine, longitudine, luogo FROM evento WHERE id = ?',
            [id],
        );
        assert.equal(Number(evento.latitudine), 41.9);
        assert.equal(evento.luogo, 'Corretto');
    });

    test('evento non in coda (già pubblicato): 404', async () => {
        const { stato } = await chiama('/admin/eventi/1', {
            metodo: 'PATCH',
            sessione: admin,
            corpo: { luogo: 'Non dovrebbe funzionare' },
        });
        assert.equal(stato, 404);
    });
});

describe('approvazione', () => {
    test('senza coordinate: 400, non approvato', async () => {
        const id = await creaEventoInCoda({
            titolo: 'Senza coordinate',
            idEsterno: `admin-test-${Date.now()}-c`,
            latitudine: null,
            longitudine: null,
        });

        const { stato } = await chiama(`/admin/eventi/${id}/approva`, {
            metodo: 'POST',
            sessione: admin,
        });
        assert.equal(stato, 400);

        const [[evento]] = await db.query(
            'SELECT stato FROM evento WHERE id = ?',
            [id],
        );
        assert.equal(evento.stato, 'in_coda');
    });

    test('con coordinate: 204, stato pubblicato e visibile su /eventi/:id', async () => {
        const id = await creaEventoInCoda({
            titolo: 'Pronto per approvazione',
            idEsterno: `admin-test-${Date.now()}-d`,
        });

        const approvazione = await chiama(`/admin/eventi/${id}/approva`, {
            metodo: 'POST',
            sessione: admin,
        });
        assert.equal(approvazione.stato, 204);

        const pubblico = await chiama(`/eventi/${id}`);
        assert.equal(pubblico.stato, 200);
    });
});

describe('scarto', () => {
    test('scarta: 204, stato scartato, invisibile su /eventi/:id', async () => {
        const id = await creaEventoInCoda({
            titolo: 'Da scartare',
            idEsterno: `admin-test-${Date.now()}-e`,
        });

        const scarto = await chiama(`/admin/eventi/${id}/scarta`, {
            metodo: 'POST',
            sessione: admin,
        });
        assert.equal(scarto.stato, 204);

        const [[evento]] = await db.query(
            'SELECT stato FROM evento WHERE id = ?',
            [id],
        );
        assert.equal(evento.stato, 'scartato');

        const pubblico = await chiama(`/eventi/${id}`);
        assert.equal(pubblico.stato, 404);
    });
});

describe('conferma collegamento artista', () => {
    test('senza candidato: 400', async () => {
        const id = await creaEventoInCoda({
            titolo: 'Senza candidato',
            idEsterno: `admin-test-${Date.now()}-f`,
            idAttractionCandidato: null,
        });

        const { stato } = await chiama(
            `/admin/eventi/${id}/artisti/${novaCircuit.id}/conferma-collegamento`,
            { metodo: 'POST', sessione: admin },
        );
        assert.equal(stato, 400);
    });

    test("con candidato: 204, id_ticketmaster impostato sull'artista", async () => {
        const id = await creaEventoInCoda({
            titolo: 'Con candidato',
            idEsterno: `admin-test-${Date.now()}-g`,
            idAttractionCandidato: 'attraction-conferma-test',
        });

        const conferma = await chiama(
            `/admin/eventi/${id}/artisti/${novaCircuit.id}/conferma-collegamento`,
            { metodo: 'POST', sessione: admin },
        );
        assert.equal(conferma.stato, 204);

        const [[artista]] = await db.query(
            'SELECT id_ticketmaster FROM artista WHERE id = ?',
            [novaCircuit.id],
        );
        assert.equal(artista.id_ticketmaster, 'attraction-conferma-test');
    });

    test("approvare l'evento non conferma da solo il collegamento", async () => {
        const id = await creaEventoInCoda({
            titolo: 'Approvato senza conferma',
            idEsterno: `admin-test-${Date.now()}-h`,
            idAttractionCandidato: 'attraction-non-confermata',
        });

        await db.query(
            'UPDATE artista SET id_ticketmaster = NULL WHERE id = ?',
            [novaCircuit.id],
        );

        const approvazione = await chiama(`/admin/eventi/${id}/approva`, {
            metodo: 'POST',
            sessione: admin,
        });
        assert.equal(approvazione.stato, 204);

        const [[artista]] = await db.query(
            'SELECT id_ticketmaster FROM artista WHERE id = ?',
            [novaCircuit.id],
        );
        assert.equal(artista.id_ticketmaster, null);
    });

    // Sequenza completa "conferma poi approva", su un artista dedicato (mai
    // novaCircuit): riproduce end-to-end il dubbio nato dalle prove a mano
    // sul telefono, dove dopo "Conferma collegamento" id_ticketmaster era
    // rimasto NULL. Ogni chiamata passa dal server vero (chiama()), non da
    // una query diretta: un'eventuale transazione qui non coprirebbe le
    // richieste HTTP, che usano il pool di connessione del server, separato
    // da quello dei test (vedi src/config/database.js vs test/aiuto.js) —
    // l'isolamento resta quindi quello del describe: cancellazione in
    // after() dell'intero file, non un rollback.
    test("conferma collegamento poi approva: id_ticketmaster resta impostato e l'evento è pubblicato", async () => {
        const idAttractionCandidato = `attraction-sequenza-${Date.now()}`;
        const id = await creaEventoInCoda({
            titolo: 'Conferma poi approva',
            idEsterno: `admin-test-${Date.now()}-seq`,
            idAttractionCandidato,
            artistaId: artistaProva.id,
        });

        const conferma = await chiama(
            `/admin/eventi/${id}/artisti/${artistaProva.id}/conferma-collegamento`,
            { metodo: 'POST', sessione: admin },
        );
        assert.equal(conferma.stato, 204);

        const approvazione = await chiama(`/admin/eventi/${id}/approva`, {
            metodo: 'POST',
            sessione: admin,
        });
        assert.equal(approvazione.stato, 204);

        const [[artista]] = await db.query(
            'SELECT id_ticketmaster FROM artista WHERE id = ?',
            [artistaProva.id],
        );
        assert.equal(artista.id_ticketmaster, idAttractionCandidato);

        const [[evento]] = await db.query(
            'SELECT stato FROM evento WHERE id = ?',
            [id],
        );
        assert.equal(evento.stato, 'pubblicato');
    });
});
