// Ricerca con match parziale su nome artista e titolo brano (GET /ricerca).
// Oltre al seed usa due artisti temporanei, inseriti e cancellati qui, per i
// casi che i dati di prova non coprono (ordine, "%" nel nome).

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { URL_API, db, verificaCanarina } = require('./aiuto');

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
    await verificaCanarina();
    await db.query('INSERT INTO artista (nome) VALUES ?', [
        ARTISTI_TEMPORANEI.map(nome => [nome]),
    ]);
});

after(async () => {
    await db.query('DELETE FROM artista WHERE nome IN (?)', [
        ARTISTI_TEMPORANEI,
    ]);
    await db.end();
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
