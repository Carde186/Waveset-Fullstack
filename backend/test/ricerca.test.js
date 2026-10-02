// Ricerca con match parziale su nome artista e titolo brano (GET /ricerca).
// Oltre al seed usa due artisti temporanei, inseriti e cancellati qui, per i
// casi che i dati di prova non coprono (ordine, "%" nel nome).

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

// db di aiuto è condiviso nel processo, non proprietà del singolo test.
// Chiuderlo solo nell'after finale del file principale in un worker isolato:
// node --env-file=../.env.test --test --test-isolation=process test/ricerca.test.js
if (require.main !== module || !process.execArgv.includes('--test-isolation=process')) {
    throw new Error('RICERCA_RICHIEDE_WORKER_ISOLATO');
}
const guardia = require('./preparaAmbiente');
const { URL_API, db, verificaCanarina } = require('./aiuto');
const mysql = require('mysql2/promise');
const { creaRegistro } = require('./helpers/registroFixture');
const { creaAdapterMysqlRegistro } = require('./helpers/adapterMysqlRegistro');

let poolPulizia, adapter, registro;
const idsArtisti = [];
// Cause originali private: preservare identità/ordine senza esporre impronte.
const causeTeardown = new WeakMap();

// "Aaa Zqx" viene prima in ordine alfabetico ma contiene "zqx" solo a metà;
// "Zqx 50% Bbb" inizia con "zqx": deve comparire per primo.
const ARTISTI_TEMPORANEI = ['Aaa Zqx', 'Zqx 50% Bbb'];

async function cerca(q) {
    const risposta = await fetch(
        `${URL_API}/ricerca?q=${encodeURIComponent(q)}`,
    );
    return { stato: risposta.status, dati: await risposta.json() };
}

const nomi = dati => dati.artisti.map(a => a.nome);
const titoli = dati => dati.brani.map(b => b.titolo);

before(async () => {
    const canarina = await verificaCanarina();
    if (canarina?.verificata !== true || canarina.pulita !== true || canarina.righeEliminate !== 1) {
        throw new Error('RICERCA_CANARINA_NON_ATTESTATA');
    }
    poolPulizia = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: guardia.DB_TEST,
        connectionLimit: 1,
        dateStrings: true,
        decimalNumbers: false,
        timezone: 'Z',
        typeCast: true,
        rowsAsArray: false,
        multipleStatements: false,
        debug: false,
    });
    adapter = await creaAdapterMysqlRegistro({ pool: poolPulizia, guardia, urlApi: URL_API });
    const baseline = await adapter.acquisisciBaseline();
    const attesi = { genere: 4, artista: 6, album: 5, brano: 9, utente: 3,
        playlist: 0, evento: 4, sessioni: 0, artista_genere: 5,
        playlist_brano: 0, evento_artista: 5, utente_artista: 2 };
    if (Object.entries(attesi).some(([tabella, totale]) => baseline[tabella].length !== totale) ||
        JSON.stringify(baseline.utente.map(r => r.id).sort((a, b) => a - b)) !== '[1,2,3]') {
        throw new Error('RICERCA_STATO_INIZIALE_INATTESO');
    }
    registro = creaRegistro(baseline);
    for (const nome of ARTISTI_TEMPORANEI) {
        const [inserito] = await db.query('INSERT INTO artista (nome) VALUES (?)', [nome]);
        registro.registraId('artista', inserito);
        idsArtisti.push(inserito.insertId);
    }
});

after(async () => {
    const errori = [];
    const erroriRollback = [];
    try {
        if (registro) {
            await registro.pulisci({
                ...adapter,
                async rollback() {
                    try { await adapter.rollback(); }
                    catch (errore) { erroriRollback.push(errore); }
                    // Il registro rilancia il suo primo errore dopo rollback;
                    // un rollback fallito viene aggiunto separatamente sotto.
                },
                async salvaAnteprima(anteprima) {
                    assert.deepEqual(anteprima.righe,
                        idsArtisti.map(id => ({ tabella: 'artista', pk: [id] })),
                        'RICERCA_PIANO_PK_NON_AMMESSE');
                    await adapter.salvaAnteprima(anteprima);
                },
            });
        }
    } catch (errore) {
        errori.push({ fase: 'PULIZIA', errore });
    } finally {
        errori.push(...erroriRollback.map(errore => ({ fase: 'ROLLBACK', errore })));
        for (const [fase, chiudi] of [
            ['ADAPTER', () => adapter?.chiudi()],
            ['POOL_PULIZIA', () => poolPulizia?.end()],
            ['DB_FIXTURE', () => db.end()],
        ]) {
            try { await chiudi(); }
            catch (errore) { errori.push({ fase: `CHIUSURA_${fase}`, errore }); }
        }
    }
    if (errori.length) {
        const fallimento = new AggregateError(errori.map(({ fase }) =>
            new Error(`RICERCA_${fase}_FALLITA`)), 'RICERCA_TEARDOWN_FALLITO');
        causeTeardown.set(fallimento, errori.map(({ errore }) => errore));
        throw fallimento;
    }
});

describe('ricerca', () => {
    test('match parziale a metà parola', async () => {
        const { dati } = await cerca('circ');

        assert.deepEqual(nomi(dati), ['Nova Circuit']);
    });

    test('ignora maiuscole e accenti', async () => {
        assert.deepEqual(nomi((await cerca('NOVA')).dati), ['Nova Circuit']);
        assert.deepEqual(titoli((await cerca('rété')).dati), ['Rete Oscura']);
    });

    test('artisti per nome e brani per titolo, in sezioni separate', async () => {
        const { dati } = await cerca('lucent');

        assert.deepEqual(nomi(dati), ['Lucent Wave']);
        assert.deepEqual(titoli(dati), ['Portale Lucente']);
        // Stessa forma di /brani/:id, con l'artista per il sottotitolo.
        assert.equal(dati.brani[0].artista.nome, 'Lucent Wave');
    });

    test('i brani non sono cercati per nome artista', async () => {
        const { dati } = await cerca('Nova Circuit');

        assert.deepEqual(nomi(dati), ['Nova Circuit']);
        assert.deepEqual(titoli(dati), []);
    });

    test('prima chi inizia con il testo, poi chi lo contiene', async () => {
        const { dati } = await cerca('zqx');

        assert.deepEqual(nomi(dati), ['Zqx 50% Bbb', 'Aaa Zqx']);
    });

    test('% e _ sono caratteri normali, non jolly', async () => {
        // Senza escape "%%" e "__" troverebbero tutto il catalogo.
        assert.deepEqual(nomi((await cerca('%%')).dati), []);
        assert.deepEqual(nomi((await cerca('__')).dati), []);
        // E "%" trova davvero il carattere "%".
        assert.deepEqual(nomi((await cerca('0%')).dati), ['Zqx 50% Bbb']);
    });

    test('meno di 2 caratteri o nessun testo: liste vuote', async () => {
        for (const q of ['a', ' ', '']) {
            const { stato, dati } = await cerca(q);

            assert.equal(stato, 200);
            assert.deepEqual(dati, { artisti: [], brani: [] });
        }
    });

    test('oltre 100 caratteri: 400', async () => {
        assert.equal((await cerca('x'.repeat(101))).stato, 400);
    });
});
