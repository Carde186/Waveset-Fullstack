// Eventi: elenco (tutti / seguiti), dettaglio, esclusione degli eventi
// passati. Seed: l'utente A segue Nova Circuit e Lucent Wave, B nessuno.

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, UTENTE_A, UTENTE_B, chiama, accedi, chiudi } = require('./aiuto');

const TITOLO_PASSATO = 'Evento passato di prova';
const TITOLO_IN_CODA = 'Evento in coda di prova';

let utenteA;
let utenteB;

before(async () => {
    utenteA = await accedi(UTENTE_A);
    utenteB = await accedi(UTENTE_B);

    // Evento di ieri con Nova Circuit (seguito da A): non deve comparire
    // né in "tutti" né in "seguiti".
    const [risultato] = await db.query(
        `INSERT INTO evento (titolo, data_evento, luogo, citta, latitudine, longitudine)
         VALUES (?, CURDATE() - INTERVAL 1 DAY, 'Luogo', 'Città', 45.0, 9.0)`,
        [TITOLO_PASSATO],
    );
    await db.query(
        'INSERT INTO evento_artista (evento_id, artista_id) VALUES (?, 1)',
        [risultato.insertId],
    );

    // Evento futuro ma in coda (import Ticketmaster non ancora approvato
    // dall'ADMIN): non deve comparire in nessuna lista pubblica.
    const [risultatoInCoda] = await db.query(
        `INSERT INTO evento (titolo, data_evento, luogo, citta, latitudine, longitudine, fonte, id_esterno, stato)
         VALUES (?, CURDATE() + INTERVAL 1 DAY, 'Luogo', 'Città', 45.0, 9.0, 'ticketmaster', 'eventi-test-in-coda', 'in_coda')`,
        [TITOLO_IN_CODA],
    );
    await db.query(
        'INSERT INTO evento_artista (evento_id, artista_id) VALUES (?, 1)',
        [risultatoInCoda.insertId],
    );
});

after(async () => {
    await db.query('DELETE FROM evento WHERE titolo IN (?, ?)', [
        TITOLO_PASSATO,
        TITOLO_IN_CODA,
    ]);
    await chiudi();
});

const titoli = eventi => eventi.map(e => e.titolo);

describe('elenco eventi', () => {
    test('tutti: futuri, per data, con coordinate numeriche e lineup', async () => {
        const { stato, dati } = await chiama('/eventi');

        assert.equal(stato, 200);
        assert.deepEqual(titoli(dati), [
            'Circuiti Live',
            'Sunset Session',
            'Notte Elettrica',
            'Drum Night',
        ]);
        assert.equal(typeof dati[0].latitudine, 'number');
        assert.equal(typeof dati[0].longitudine, 'number');

        const notte = dati.find(e => e.titolo === 'Notte Elettrica');
        assert.deepEqual(
            notte.lineup.map(a => a.nome),
            ['Lucent Wave', 'Nova Circuit'],
        );
    });

    test('un evento in coda non compare, né in "tutti" né in "seguiti", né nel dettaglio', async () => {
        const tutti = (await chiama('/eventi')).dati;
        const seguiti = (
            await chiama('/eventi?filtro=seguiti', { sessione: utenteA })
        ).dati;

        assert.ok(!titoli(tutti).includes(TITOLO_IN_CODA));
        assert.ok(!titoli(seguiti).includes(TITOLO_IN_CODA));

        const inCoda = tutti
            .concat(seguiti)
            .find(e => e.titolo === TITOLO_IN_CODA);
        assert.equal(inCoda, undefined);
    });

    test('gli eventi passati non compaiono', async () => {
        const tutti = (await chiama('/eventi')).dati;
        const seguiti = (
            await chiama('/eventi?filtro=seguiti', { sessione: utenteA })
        ).dati;

        assert.ok(!titoli(tutti).includes(TITOLO_PASSATO));
        assert.ok(!titoli(seguiti).includes(TITOLO_PASSATO));
    });

    test('seguiti: solo eventi con almeno un artista seguito', async () => {
        const { dati } = await chiama('/eventi?filtro=seguiti', {
            sessione: utenteA,
        });

        assert.deepEqual(titoli(dati), ['Circuiti Live', 'Notte Elettrica']);
    });

    test('seguiti: isolato per utente (B non segue nessuno)', async () => {
        const { stato, dati } = await chiama('/eventi?filtro=seguiti', {
            sessione: utenteB,
        });

        assert.equal(stato, 200);
        assert.deepEqual(dati, []);
    });

    test('seguiti senza sessione: 401; filtro sconosciuto: 400', async () => {
        assert.equal((await chiama('/eventi?filtro=seguiti')).stato, 401);
        assert.equal((await chiama('/eventi?filtro=altro')).stato, 400);
    });
});

describe('dettaglio evento', () => {
    test('con lineup completo', async () => {
        const { stato, dati } = await chiama('/eventi/2');

        assert.equal(stato, 200);
        assert.equal(dati.titolo, 'Notte Elettrica');
        assert.equal(dati.ora_evento, '23:30:00');
        assert.deepEqual(
            dati.lineup.map(a => a.nome),
            ['Lucent Wave', 'Nova Circuit'],
        );
    });

    test('inesistente: 404', async () => {
        assert.equal((await chiama('/eventi/999999')).stato, 404);
    });
});
