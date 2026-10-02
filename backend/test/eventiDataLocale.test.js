// Test del contratto SQL degli eventi senza connessione al DB.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const pool = require('../src/config/database');
const router = require('../src/routes/eventi');
const { COLONNE_EVENTO } = require('../src/utilita/eventi');

const riga = { id: 7, titolo: 'Live', data_evento: '2027-02-13', ora_evento: '23:30:00',
    luogo: null, citta: 'Milano', latitudine: '45.470000', longitudine: '9.180000' };

async function esegui(t, percorso, utente) {
    const query = [];
    t.mock.method(pool, 'query', async (sql, parametri) => {
        query.push({ sql, parametri });
        return [sql.startsWith('SELECT ea.evento_id') ? [] : [riga]];
    });
    const corpo = [];
    const risposta = { status(codice) { this.codice = codice; return this; }, json(dati) { corpo.push(dati); } };
    const livello = router.stack.find(l => l.route?.path === percorso);
    const gestore = livello.route.stack.at(-1).handle;
    await gestore({ query: { filtro: percorso === '/eventi' && utente ? 'seguiti' : 'tutti' },
        params: { id: '7' }, utente }, risposta);
    return { query, corpo };
}

test('tutti e dettaglio serializzano DATE come giorno locale; Novità non cambia', async t => {
    for (const percorso of ['/eventi', '/eventi/:id']) {
        t.mock.restoreAll();
        const { query, corpo } = await esegui(t, percorso);
        assert.match(query[0].sql, /DATE_FORMAT\(e\.data_evento, '%Y-%m-%d'\) AS data_evento/);
        const evento = percorso === '/eventi' ? corpo[0][0] : corpo[0];
        assert.equal(evento.data_evento, '2027-02-13');
    }
    assert.equal(COLONNE_EVENTO.includes('DATE_FORMAT'), false);
});

test('filtro seguiti usa la data stabile e la sessione ricevuta', async t => {
    const { query, corpo } = await esegui(t, '/eventi', { id: 42 });
    assert.match(query[0].sql, /DATE_FORMAT\(e\.data_evento, '%Y-%m-%d'\)/);
    assert.deepEqual(query[0].parametri, [42]);
    assert.equal(corpo[0][0].data_evento, '2027-02-13');
});
