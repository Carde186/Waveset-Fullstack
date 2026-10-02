'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Non importare aiuto.js: aprirebbe il pool. Eseguire solo le funzioni
// canarina del file effettivo, con db/fetch/crypto interamente in memoria.
const sorgente = fs.readFileSync(path.join(__dirname, 'aiuto.js'), 'utf8');
const inizio = sorgente.indexOf('let verificaPronta;');
const fine = sorgente.indexOf('\nasync function chiama(');
assert.ok(inizio >= 0 && fine > inizio);
const funzioni = sorgente.slice(inizio, fine);

function prova(opzioni = {}) {
    const righe = [], chiamate = [];
    const db = { async query(sql, parametri) {
        if (sql === "SELECT COUNT(*) AS altri FROM information_schema.schemata WHERE schema_name = 'waveset'") {
            chiamate.push('guardia'); return [[{ altri: opzioni.altri || 0 }], []];
        }
        if (sql === 'INSERT INTO genere (nome) VALUES (?)') {
            chiamate.push('insert');
            if (opzioni.erroreInsert) throw new Error('INSERT_MOCK_FALLITA');
            righe.push({ id: 9001, nome: parametri[0] });
            return [{ insertId: 9001, affectedRows: 1 }, undefined];
        }
        if (sql === 'DELETE FROM genere WHERE id = ? AND nome = ?') {
            chiamate.push('delete');
            assert.deepEqual(Array.from(parametri), [9001, '__canary_fixture-pubblica']);
            if (opzioni.erroreDelete) throw new Error('DELETE_MOCK_FALLITA');
            const i = righe.findIndex(r => r.id === parametri[0] && r.nome === parametri[1]);
            const affectedRows = Object.hasOwn(opzioni, 'conteggio') ? opzioni.conteggio : (i < 0 ? 0 : 1);
            if (affectedRows === 1 && i >= 0) righe.splice(i, 1);
            return [{ affectedRows }, undefined];
        }
        throw new Error('SQL_NON_AMMESSO_DAL_MOCK');
    } };
    const contesto = vm.createContext({ db, assert, crypto: { randomUUID: () => 'fixture-pubblica' },
        URL_API: 'http://127.0.0.1:3084/api', fetch: async () => {
            chiamate.push('http');
            return { ok: !opzioni.erroreHttp, json: async () => {
                const risposta = structuredClone(righe);
                if (opzioni.mutaNome) righe[0].nome = 'nome-mutato-sintetico';
                return risposta;
            } };
        } });
    new vm.Script(funzioni + '\nglobalThis.verifica = verificaCanarina;').runInContext(contesto, { timeout: 1000 });
    return { verifica: contesto.verifica, righe, chiamate };
}

test('canarina: successo restituisce solo attestazione immutabile e pulisce id+nome', async () => {
    const p = prova(), esito = await p.verifica();
    assert.deepEqual({ ...esito }, { verificata: true, pulita: true, righeEliminate: 1 });
    assert.ok(Object.isFrozen(esito));
    assert.equal(p.righe.length, 0);
    assert.deepEqual(p.chiamate, ['guardia', 'insert', 'http', 'delete']);
});
test('canarina: memoizzazione unica, stessa promessa e nessuna seconda scrittura', async () => {
    const p = prova(), prima = p.verifica(), seconda = p.verifica();
    assert.equal(prima, seconda); await prima;
    assert.equal(p.verifica(), prima);
    assert.equal(p.chiamate.filter(x => x === 'insert').length, 1);
    assert.equal(p.chiamate.filter(x => x === 'delete').length, 1);
});
test('canarina: affectedRows zero blocca baseline e resta un fallimento memorizzato', async () => {
    const p = prova({ mutaNome: true }); let baseline = 0;
    const inizializza = async () => { await p.verifica(); baseline++; };
    await assert.rejects(inizializza(), { message: 'CANARINA_PULIZIA_CONTEGGIO_INATTESO' });
    await assert.rejects(inizializza(), { message: 'CANARINA_PULIZIA_CONTEGGIO_INATTESO' });
    assert.equal(baseline, 0); assert.equal(p.righe.length, 1);
    assert.equal(p.chiamate.filter(x => x === 'delete').length, 1);
});
for (const conteggio of [2, '1', undefined]) {
    test(`canarina: conteggio inatteso (${typeof conteggio}) rifiutato`, async () => {
        const p = prova({ conteggio });
        await assert.rejects(p.verifica(), { message: 'CANARINA_PULIZIA_CONTEGGIO_INATTESO' });
    });
}
test('canarina: errore HTTP pulisce ma non attesta successo', async () => {
    const p = prova({ erroreHttp: true });
    await assert.rejects(p.verifica(), /non legge il database di test/);
    assert.equal(p.righe.length, 0); assert.equal(p.chiamate.at(-1), 'delete');
});
test('canarina: errore INSERT prima dell’ID non avvia DELETE né HTTP', async () => {
    const p = prova({ erroreInsert: true });
    await assert.rejects(p.verifica(), { message: 'INSERT_MOCK_FALLITA' });
    assert.deepEqual(p.chiamate, ['guardia', 'insert']);
});
test('canarina: errore DELETE non attesta successo', async () => {
    const p = prova({ erroreDelete: true });
    await assert.rejects(p.verifica(), { message: 'DELETE_MOCK_FALLITA' });
    assert.equal(p.righe.length, 1);
});
test('canarina: guardia negativa impedisce INSERT e HTTP', async () => {
    const p = prova({ altri: 1 });
    await assert.rejects(p.verifica(), /contiene anche il DB/);
    assert.deepEqual(p.chiamate, ['guardia']);
});
