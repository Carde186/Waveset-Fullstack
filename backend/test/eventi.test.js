// Eventi: elenco (tutti / seguiti), dettaglio, esclusione degli eventi
// passati. Catalogo pubblico temporaneo: A segue un artista, B nessuno.

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { UTENTE_A, UTENTE_B, chiama, accedi, chiudi } = require('./aiuto');
const { creaCatalogoPubblico } = require('./helpers/catalogoPubblico');

let utenteA;
let utenteB;
let fixture;
let passato;
let inCoda;

before(async () => {
    utenteA = await accedi(UTENTE_A);
    utenteB = await accedi(UTENTE_B);

    fixture = await creaCatalogoPubblico({ utenteId: utenteA.utente.id });
    const lineup = [fixture.artisti[0].id];
    passato = await fixture.aggiungiEvento({ titolo: 'Evento passato di prova', giorni: -1, lineup });
    inCoda = await fixture.aggiungiEvento({ titolo: 'Evento in coda di prova', giorni: 1, lineup, stato: 'in_coda' });
});

after(async () => {
    try { await fixture?.pulisci(); }
    finally { await chiudi(); }
});

const titoli = eventi => eventi.map(e => e.titolo);

describe('elenco eventi', () => {
    test('tutti: futuri, per data, con coordinate numeriche e lineup', async () => {
        const { stato, dati } = await chiama('/eventi');

        assert.equal(stato, 200);
        assert.deepEqual(titoli(dati), titoli(fixture.eventi));
        assert.equal(typeof dati[0].latitudine, 'number');
        assert.equal(typeof dati[0].longitudine, 'number');

        assert.equal(dati[3].latitudine, null);
        assert.equal(dati[3].longitudine, null);
        const notte = dati.find(e => e.id === fixture.eventi[2].id);
        assert.deepEqual(
            notte.lineup.map(a => a.nome),
            fixture.artisti.map(a => a.nome),
        );
    });

    test('un evento in coda non compare, né in "tutti" né in "seguiti", né nel dettaglio', async () => {
        const tutti = (await chiama('/eventi')).dati;
        const seguiti = (
            await chiama('/eventi?filtro=seguiti', { sessione: utenteA })
        ).dati;

        assert.ok(!titoli(tutti).includes(inCoda.titolo));
        assert.ok(!titoli(seguiti).includes(inCoda.titolo));
        assert.equal((await chiama(`/eventi/${inCoda.id}`)).stato, 404);
    });

    test('gli eventi passati non compaiono', async () => {
        const tutti = (await chiama('/eventi')).dati;
        const seguiti = (
            await chiama('/eventi?filtro=seguiti', { sessione: utenteA })
        ).dati;

        assert.ok(!titoli(tutti).includes(passato.titolo));
        assert.ok(!titoli(seguiti).includes(passato.titolo));
    });

    test('seguiti: solo eventi con almeno un artista seguito', async () => {
        const { dati } = await chiama('/eventi?filtro=seguiti', {
            sessione: utenteA,
        });

        assert.deepEqual(titoli(dati), [fixture.eventi[0].titolo, fixture.eventi[2].titolo]);
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
        const { stato, dati } = await chiama(`/eventi/${fixture.eventi[2].id}`);

        assert.equal(stato, 200);
        assert.equal(dati.titolo, fixture.eventi[2].titolo);
        assert.equal(dati.ora_evento, '23:30:00');
        assert.deepEqual(
            dati.lineup.map(a => a.nome),
            fixture.artisti.map(a => a.nome),
        );
    });

    test('inesistente: 404', async () => {
        assert.equal((await chiama('/eventi/999999')).stato, 404);
    });

    test('un evento con artisti demo resta nascosto', async () => {
        assert.equal((await chiama('/eventi/2')).stato, 404);
    });
});
