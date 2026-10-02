'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { creaRegistro, SCHEMA } = require('./helpers/registroFixture');
const A = require('./helpers/adapterMysqlRegistro');
const copia = x => structuredClone(x);
const tabs = Object.keys(SCHEMA);
const impronta = label => createHash('sha256').update(label).digest('hex');
const riga = (id, fk = {}) => ({ id, ...fk, impronta: impronta(`riga-${id}`) });
function iniziale() {
    const s = Object.fromEntries(tabs.map(t => [t, []]));
    s.utente = [1, 2, 3].map(id => riga(id));
    s.artista = [riga(1)]; s.genere = [riga(1)];
    s.utente_artista = [1, 2].map(utente_id => ({ utente_id, artista_id: 1, impronta: impronta(`follow-${utente_id}`) }));
    return s;
}
function metadati() {
    const ordine = tabs.slice().sort();
    return {
        tabelle: ordine.map(tabella => ({ tabella, motore: 'InnoDB', tipo: 'BASE TABLE' })),
        colonne: ordine.flatMap(tabella => A.COLONNE[tabella].split(' ').map(x => {
            const [colonna, tipo] = x.split(':');
            return { tabella, colonna, tipo, temporale: ['time', 'datetime', 'timestamp'].includes(tipo) ? 0 : null, precisione: tipo === 'decimal' ? 9 : null, scala: tipo === 'decimal' ? 6 : null };
        })),
        pk: ordine.flatMap(tabella => SCHEMA[tabella].pk.map(colonna => ({ tabella, colonna }))),
        fk: tabs.flatMap(figlio => Object.entries(SCHEMA[figlio].fk).map(([colonna, padre]) => ({ schema_figlio: 'waveset_test', figlio, colonna, schema_padre: 'waveset_test', padre, pk: 'id', regola: figlio === 'brano' && colonna === 'album_id' ? 'SET NULL' : 'CASCADE' }))),
        trigger: [{ totale: 0 }],
    };
}
// Trasporto mysql2 interamente in memoria. Match SQL letterale: nessun parser
// INSERT, driver mysql2, aiuto/preparaAmbiente, socket, Docker o database.
function trasporto(opzioni = {}) {
    let s = iniziale(), backup, round = 0, commit = 0;
    const chiamate = [], canali = [], m = metadati();
    const conn = {
        config: { host: ambiente.DB_HOST, port: Number(ambiente.DB_PORT), database: ambiente.DB_NAME,
            user: ambiente.DB_USER, password: ambiente.DB_PASSWORD, dateStrings: true,
            decimalNumbers: false, timezone: 'Z', typeCast: true, rowsAsArray: false,
            multipleStatements: false, ...opzioni.config },
        async execute(sql, p) {
            canali.push({ metodo: 'execute', sql });
            assert.notEqual(sql, A.SQL.baseline, 'START non supportato dal protocollo prepared');
            if (sql === A.SQL.database) { chiamate.push('database'); return [[{ db: opzioni.database || 'waveset_test' }], []]; }
            for (const k of ['timezone', 'charset', 'ripetibile', 'serializzabile']) if (sql === A.SQL[k]) {
                assert.deepEqual(p, []); chiamate.push(k);
                return [{ affectedRows: 0 }, undefined];
            }
            for (const k of ['tabelle', 'colonne', 'pk', 'fk', 'trigger']) if (sql === A.SQL[k]) {
                assert.deepEqual(p, k === 'fk' ? ['waveset_test', 'waveset_test'] : ['waveset_test']);
                chiamate.push(`meta:${k}`); return [copia(m[k]), []];
            }
            for (const t of tabs) for (const blocca of [false, true]) if (sql === A.snapshotSQL(t, blocca)) {
                assert.equal(p.length, 1); assert.ok(Buffer.isBuffer(p[0]) && p[0].length === 32);
                // Non conservare mai il parametro pepper, neppure nel mock.
                chiamate.push(`read:${t}:${blocca}`);
                if (t === tabs[0]) {
                    round++;
                    if (opzioni.erroreLettura === round) throw new Error('messaggio driver da non propagare');
                    if (opzioni.mutaSeconda && round === 3) s.utente[0].impronta = impronta('modificata');
                }
                return [copia(s[t]), []];
            }
            for (const t of tabs) if (sql === A.deletes[t]) {
                const i = s[t].findIndex(r => SCHEMA[t].pk.every((c, n) => r[c] === p[n]));
                chiamate.push({ delete: t, pk: copia(p) });
                if (opzioni.conteggioInatteso === true || opzioni.conteggioInatteso === chiamate.filter(c => typeof c === 'object').length) return [{ affectedRows: 0 }, undefined];
                if (i < 0) return [{ affectedRows: 0 }, undefined];
                s[t].splice(i, 1); return [{ affectedRows: 1 }, undefined];
            }
            assert.fail('SQL non compreso nel contratto offline');
        },
        async query(sql) {
            assert.equal(arguments.length, 1, 'query riceve solo SQL letterale');
            assert.equal(sql, A.SQL.baseline, 'query ammette solo START baseline');
            canali.push({ metodo: 'query', sql }); chiamate.push('baseline');
            if (opzioni.erroreStart) throw new Error('errore driver sintetico da non propagare');
            backup = copia(s); return [{ affectedRows: 0 }, undefined];
        },
        async beginTransaction() { chiamate.push('beginTransaction'); backup = copia(s); },
        async commit() {
            chiamate.push('commit'); commit++;
            if ((opzioni.commitAmbiguo && commit === 2) || (opzioni.commitAmbiguoBaseline && commit === 1)) { backup = undefined; throw new Error('ack COMMIT perduto'); }
            backup = undefined;
        },
        async rollback() {
            chiamate.push('rollback');
            if (opzioni.rollbackFallito) throw new Error('rollback non confermato');
            if (backup) s = copia(backup); backup = undefined;
        },
        release() { chiamate.push('release'); },
        destroy() { chiamate.push('destroy'); },
    };
    return { pool: { async getConnection() { chiamate.push('getConnection'); return conn; } },
        get s() { return s; }, m, chiamate, canali };
}
const ambiente = { DB_NAME: 'waveset_test', DB_HOST: '127.0.0.1', DB_PORT: '3309', MYSQL_HOST_PORT: '3309', DB_USER: 'fixture-offline', DB_PASSWORD: 'solo-memoria', BACKEND_HOST_PORT: '3084' };
const guardia = { DB_TEST: 'waveset_test', verificaUrlAmmesso(url) { assert.equal(url, 'http://127.0.0.1:3084/api'); } };
async function apri(opzioni = {}) {
    const f = trasporto(opzioni);
    const adapter = await A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://127.0.0.1:3084/api', ambiente });
    const baseline = await adapter.acquisisciBaseline();
    return { f, adapter, baseline, registro: creaRegistro(baseline) };
}
function inserisci(ctx, t, id, fk = {}) {
    ctx.f.s[t].push(riga(id, fk));
    ctx.registro.registraId(t, { insertId: id, affectedRows: 1 }, fk);
}
function associa(ctx, t, pk) {
    ctx.f.s[t].push({ ...pk, impronta: impronta(JSON.stringify(pk)) });
    ctx.registro.registraAssociazione(t, { affectedRows: 1 }, pk);
}
const cancellazioni = f => f.chiamate.filter(c => typeof c === 'object');
const conteggi = righe => Object.fromEntries(A.ORDINE.map(t => [t, righe.filter(r => r.tabella === t).length]));

test('routing: START letterale usa query una volta e senza parametri', async () => {
    const c = await apri();
    try {
        assert.deepEqual(c.f.canali.filter(x => x.metodo === 'query'), [{ metodo: 'query', sql: A.SQL.baseline }]);
        assert.equal(c.f.canali.filter(x => x.metodo === 'execute' && x.sql === A.SQL.baseline).length, 0);
    } finally { await c.adapter.chiudi(); }
});
test('routing: SELECT con binding e DELETE per PK restano su execute', async () => {
    const c = await apri();
    try {
        inserisci(c, 'artista', 101);
        await c.registro.pulisci(c.adapter);
        for (const k of ['tabelle', 'colonne', 'pk', 'fk', 'trigger']) {
            assert.ok(c.f.canali.some(x => x.metodo === 'execute' && x.sql === A.SQL[k]));
        }
        for (const t of tabs) for (const blocca of [false, true]) {
            assert.ok(c.f.canali.some(x => x.metodo === 'execute' && x.sql === A.snapshotSQL(t, blocca)));
        }
        assert.ok(c.f.canali.some(x => x.metodo === 'execute' && x.sql === A.deletes.artista));
        assert.equal(c.f.canali.filter(x => x.metodo === 'query').length, 1);
    } finally { await c.adapter.chiudi(); }
});
test('routing: errore query START blocca baseline, rollback e release senza fallback', async () => {
    const f = trasporto({ erroreStart: true });
    const adapter = await A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://127.0.0.1:3084/api', ambiente });
    try {
        await assert.rejects(adapter.acquisisciBaseline(), { message: 'BASELINE_FALLITA' });
        await assert.rejects(adapter.acquisisciBaseline(), { message: 'TRANSIZIONE_NON_AMMESSA' });
        assert.equal(f.chiamate.filter(x => x === 'rollback').length, 1);
        assert.equal(f.chiamate.filter(x => typeof x === 'string' && x.startsWith('read:')).length, 0);
        assert.equal(f.chiamate.filter(x => x === 'commit').length, 0);
        assert.equal(f.canali.filter(x => x.sql === A.SQL.baseline).length, 1);
    } finally { await adapter.chiudi(); }
    assert.equal(f.chiamate.filter(x => x === 'release').length, 1);
});

test('contratto completo: baseline, registro reale, anteprima, due letture, commit, release', async () => {
    const c = await apri();
    try {
        inserisci(c, 'artista', 101); inserisci(c, 'artista', 207);
        const righe = [{ tabella: 'artista', pk: [101] }, { tabella: 'artista', pk: [207] }];
        const attesi = conteggi(righe);
        assert.deepEqual(await c.registro.pulisci(c.adapter), attesi);
        assert.deepEqual(c.adapter.leggiAnteprima(), { righe, conteggi: attesi });
        assert.deepEqual(cancellazioni(c.f), [{ delete: 'artista', pk: [101] }, { delete: 'artista', pk: [207] }]);
        assert.deepEqual(c.f.s, c.baseline);
        assert.equal(c.f.chiamate.filter(x => x === 'read:genere:true').length, 2);
        assert.equal(c.f.chiamate.filter(x => x === 'commit').length, 2);
        assert.ok(c.f.chiamate.indexOf('baseline') < c.f.chiamate.indexOf('beginTransaction'));
    } finally { await c.adapter.chiudi(); }
    await c.adapter.chiudi();
    assert.equal(c.f.chiamate.filter(x => x === 'release').length, 1);
    assert.equal(c.f.chiamate.at(-1), 'release');
});
test('contratto: ordine su tutte le dodici tabelle e PK composte', async () => {
    const c = await apri();
    try {
        inserisci(c, 'utente', 101); inserisci(c, 'artista', 101); inserisci(c, 'genere', 101);
        inserisci(c, 'evento', 101); inserisci(c, 'album', 101, { artista_id: 101 });
        inserisci(c, 'brano', 101, { artista_id: 101, album_id: 101 });
        inserisci(c, 'playlist', 101, { utente_id: 101 }); inserisci(c, 'sessioni', 101, { utente_id: 101 });
        associa(c, 'artista_genere', { artista_id: 101, genere_id: 101 });
        associa(c, 'playlist_brano', { playlist_id: 101, brano_id: 101 });
        associa(c, 'evento_artista', { evento_id: 101, artista_id: 101 });
        associa(c, 'utente_artista', { utente_id: 101, artista_id: 101 });
        await c.registro.pulisci(c.adapter);
        assert.deepEqual(cancellazioni(c.f).map(r => r.delete), A.ORDINE);
        for (const [figlio, schema] of Object.entries(SCHEMA)) for (const padre of Object.values(schema.fk)) {
            assert.ok(A.ORDINE.indexOf(figlio) < A.ORDINE.indexOf(padre), 'Ogni figlio precede ogni padre');
        }
        assert.deepEqual(c.f.s, c.baseline);
    } finally { await c.adapter.chiudi(); }
});
test('intermedie artista/genere e finale: nessuna altra fixture o seed', async () => {
    const c = await apri();
    try {
        inserisci(c, 'artista', 101); inserisci(c, 'artista', 207); inserisci(c, 'genere', 101);
        associa(c, 'artista_genere', { artista_id: 101, genere_id: 101 });
        await c.registro.pulisci(c.adapter, 'artista', [101]);
        assert.deepEqual(cancellazioni(c.f), [{ delete: 'artista_genere', pk: [101, 101] }, { delete: 'artista', pk: [101] }]);
        assert.ok(c.f.s.artista.some(r => r.id === 207)); assert.ok(c.f.s.genere.some(r => r.id === 101));
        await c.registro.pulisci(c.adapter, 'genere', [101]);
        assert.deepEqual(c.adapter.leggiAnteprima().righe, [{ tabella: 'genere', pk: [101] }]);
        await c.registro.pulisci(c.adapter);
        assert.deepEqual(c.adapter.leggiAnteprima().righe, [{ tabella: 'artista', pk: [207] }]);
        assert.deepEqual(c.f.s, c.baseline);
    } finally { await c.adapter.chiudi(); }
});
test('PK duplicate e baseline rifiutate dal registro reale', async () => {
    const c = await apri();
    try {
        assert.throws(() => c.registro.registraId('artista', { insertId: 1, affectedRows: 1 }), /iniziale/);
        inserisci(c, 'artista', 101);
        assert.throws(() => c.registro.registraId('artista', { insertId: 101, affectedRows: 1 }), /duplicata/);
        await c.registro.pulisci(c.adapter);
    } finally { await c.adapter.chiudi(); }
});
for (const caso of ['id-non-registrato', 'dipendenza', 'estranea', 'baseline-modificata', 'id-ambiguo']) {
    test(`rollback prima di DELETE: ${caso}`, async () => {
        const c = await apri(); inserisci(c, 'artista', 101);
        try {
            let args = [];
            if (caso === 'id-non-registrato') args = ['artista', [999]];
            if (caso === 'dipendenza') c.f.s.album.push(riga(102, { artista_id: 101 }));
            if (caso === 'estranea') c.f.s.genere.push(riga(901));
            if (caso === 'baseline-modificata') c.f.s.utente[0].impronta = impronta('cambiata');
            if (caso === 'id-ambiguo') await assert.rejects(c.registro.conOperazione(async () => { throw new Error('esito ignoto'); }, () => {}));
            const prima = copia(c.f.s);
            await assert.rejects(c.registro.pulisci(c.adapter, ...args));
            assert.deepEqual(cancellazioni(c.f), []); assert.deepEqual(c.f.s, prima);
            assert.equal(c.f.chiamate.filter(x => x === 'rollback').length, 1);
            await assert.rejects(c.registro.pulisci(c.adapter), /già fallita/);
        } finally { await c.adapter.chiudi(); }
    });
}
for (const [titolo, opzioni] of [['conteggio inatteso', { conteggioInatteso: true }], ['seconda lettura modificata', { mutaSeconda: true }], ['errore seconda lettura', { erroreLettura: 3 }]]) {
    test(`rollback senza COMMIT: ${titolo}`, async () => {
        const c = await apri(opzioni); inserisci(c, 'artista', 101); const prima = copia(c.f.s);
        try {
            await assert.rejects(c.registro.pulisci(c.adapter));
            assert.deepEqual(c.f.s, prima);
            assert.equal(c.f.chiamate.filter(x => x === 'commit').length, 1);
            assert.equal(c.f.chiamate.filter(x => x === 'rollback').length, 1);
        } finally { await c.adapter.chiudi(); }
    });
}
test('fallimento prima della seconda INSERT: pulisce soltanto la prima PK certa', async () => {
    const c = await apri();
    try {
        inserisci(c, 'artista', 101);
        // La seconda INSERT non è stata invocata: nessuna operazione ambigua.
        await c.registro.pulisci(c.adapter);
        assert.deepEqual(cancellazioni(c.f), [{ delete: 'artista', pk: [101] }]);
    } finally { await c.adapter.chiudi(); }
});
test('conteggio inatteso sulla seconda DELETE: ripristina anche la prima DELETE', async () => {
    const c = await apri({ conteggioInatteso: 2 });
    inserisci(c, 'artista', 101); inserisci(c, 'artista', 207); const prima = copia(c.f.s);
    try {
        await assert.rejects(c.registro.pulisci(c.adapter), /DELETE_CONTEGGIO/);
        assert.equal(cancellazioni(c.f).length, 2); assert.deepEqual(c.f.s, prima);
        assert.equal(c.f.chiamate.filter(x => x === 'commit').length, 1);
    } finally { await c.adapter.chiudi(); }
});
test('piano esaurito: COMMIT ancora vietato prima della seconda lettura', async () => {
    const c = await apri(); inserisci(c, 'artista', 101);
    try {
        await c.adapter.beginTransaction(); const p = c.registro.pianifica(await c.adapter.leggiStato(A.selezioni));
        await c.adapter.salvaAnteprima({ righe: [{ tabella: 'artista', pk: [101] }], conteggi: p.conteggi });
        await c.adapter.query(A.deletes.artista, [101]);
        await assert.rejects(c.adapter.commit(), /TRANSIZIONE/); await c.adapter.rollback();
        assert.ok(c.f.s.artista.some(r => r.id === 101));
    } finally { await c.adapter.chiudi(); }
});
test('errore baseline: rollback e release una sola volta', async () => {
    const f = trasporto({ erroreLettura: 1 });
    const a = await A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://127.0.0.1:3084/api', ambiente });
    await assert.rejects(a.acquisisciBaseline(), /BASELINE_FALLITA/);
    await a.chiudi(); await a.chiudi();
    assert.deepEqual(f.chiamate.slice(-2), ['rollback', 'release']);
});
test('chiusura con transazione aperta: rollback prima di release', async () => {
    const c = await apri(); await c.adapter.beginTransaction(); await c.adapter.chiudi();
    assert.deepEqual(c.f.chiamate.slice(-2), ['rollback', 'release']);
    await assert.rejects(c.adapter.beginTransaction(), /TRANSIZIONE/);
});
test('COMMIT baseline incerto: rollback tentato e destroy, nessuna release', async () => {
    const f = trasporto({ commitAmbiguoBaseline: true });
    const a = await A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://127.0.0.1:3084/api', ambiente });
    await assert.rejects(a.acquisisciBaseline(), /BASELINE_FALLITA/); await a.chiudi();
    assert.deepEqual(f.chiamate.slice(-3), ['commit', 'rollback', 'destroy']);
});
test('rollback fallito: distruzione, nessuna release, chiusura idempotente', async () => {
    const c = await apri({ rollbackFallito: true });
    c.f.s.genere.push(riga(900));
    await assert.rejects(c.registro.pulisci(c.adapter), /ROLLBACK_FALLITO/);
    await c.adapter.chiudi(); await c.adapter.chiudi();
    assert.equal(c.f.chiamate.filter(x => x === 'destroy').length, 1);
    assert.ok(!c.f.chiamate.includes('release'));
});
test('COMMIT con ACK perso: rollback tentato, connessione distrutta, nessuna falsa promessa di ripristino', async () => {
    const c = await apri({ commitAmbiguo: true }); inserisci(c, 'artista', 101);
    await assert.rejects(c.registro.pulisci(c.adapter), /COMMIT_ESITO_INCERTO/);
    await c.adapter.chiudi();
    assert.deepEqual(c.f.chiamate.slice(-3), ['commit', 'rollback', 'destroy']);
    assert.deepEqual(c.f.s, c.baseline); // COMMIT era già avvenuto nel modello.
});
test('connessione fuori target: nessuna lettura di tabella, distruzione', async () => {
    const f = trasporto({ database: 'altro-schema-sintetico' });
    await assert.rejects(A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://127.0.0.1:3084/api', ambiente }), /APERTURA_FALLITA/);
    assert.deepEqual(f.chiamate, ['getConnection', 'database', 'destroy']);
});
test('guardie ambiente e URL precedono getConnection', async () => {
    for (const modifica of [{ DB_NAME: 'altro' }, { DB_HOST: 'mysql' }, { DB_PORT: '3306' }, { DB_PASSWORD: '' }]) {
        const f = trasporto();
        await assert.rejects(A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://127.0.0.1:3084/api', ambiente: { ...ambiente, ...modifica } }));
        assert.deepEqual(f.chiamate, []);
    }
    const f = trasporto();
    await assert.rejects(A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://non-ammesso.invalid/api', ambiente }), /URL_NON_TEST/);
    assert.deepEqual(f.chiamate, []);
});
test('configurazione effettiva mysql2 diverge: arresto prima di qualsiasi query', async () => {
    for (const config of [{ port: 3306 }, { database: 'altro' }, { host: 'mysql' }, { socketPath: '/synthetic' },
        { dateStrings: false }, { decimalNumbers: true }, { timezone: 'local' }, { typeCast: false }, { debug: true }]) {
        const f = trasporto({ config });
        await assert.rejects(A.creaAdapterMysqlRegistro({ pool: f.pool, guardia, urlApi: 'http://127.0.0.1:3084/api', ambiente }), /APERTURA_FALLITA/);
        assert.deepEqual(f.chiamate, ['getConnection', 'destroy']);
    }
});
test('forme e transizioni identiche: SQL diverso, preview prima della lettura, baseline doppia vietati', async () => {
    const c = await apri();
    try {
        await assert.rejects(c.adapter.acquisisciBaseline(), /TRANSIZIONE/);
        await assert.rejects(c.adapter.salvaAnteprima({ righe: [], conteggi: {} }), /TRANSIZIONE/);
        await c.adapter.beginTransaction();
        await assert.rejects(c.adapter.leggiStato({}), /SELECT_CONTRATTO/);
        await c.adapter.rollback();
    } finally { await c.adapter.chiudi(); }
});
test('DELETE non in anteprima o criterio diverso: respinta prima del trasporto', async () => {
    const c = await apri(); inserisci(c, 'artista', 101);
    try {
        await c.adapter.beginTransaction(); const s = await c.adapter.leggiStato(A.selezioni);
        const piano = c.registro.pianifica(s);
        await c.adapter.salvaAnteprima({ righe: [{ tabella: 'artista', pk: [101] }], conteggi: piano.conteggi });
        for (const sql of ['DELETE FROM artista WHERE nome = ?', 'DELETE FROM artista WHERE id LIKE ?', A.deletes.artista]) {
            await assert.rejects(c.adapter.query(sql, [999]), /DELETE_NON_AUTORIZZATA/);
        }
        assert.deepEqual(cancellazioni(c.f), []); await c.adapter.rollback();
    } finally { await c.adapter.chiudi(); }
});
test('seconda lettura e COMMIT vietati finché il piano non è esaurito', async () => {
    const c = await apri(); inserisci(c, 'artista', 101);
    try {
        await c.adapter.beginTransaction(); const p = c.registro.pianifica(await c.adapter.leggiStato(A.selezioni));
        await c.adapter.salvaAnteprima({ righe: [{ tabella: 'artista', pk: [101] }], conteggi: p.conteggi });
        await assert.rejects(c.adapter.commit(), /TRANSIZIONE/);
        await assert.rejects(c.adapter.leggiStato(A.selezioni), /PIANO_INCOMPLETO/);
        await c.adapter.rollback();
    } finally { await c.adapter.chiudi(); }
});
test('metadati divergenti bloccano engine, colonne, precisione, PK, FK e trigger', () => {
    A.verificaMetadati(metadati());
    const mutazioni = [m => { m.tabelle[0].motore = 'MyISAM'; }, m => { m.colonne.pop(); },
        m => { m.colonne.find(r => r.tipo === 'time').temporale = 6; }, m => { m.colonne.find(r => r.tipo === 'decimal').scala = 5; },
        m => { m.pk.pop(); }, m => { m.fk[0].schema_figlio = 'esterno'; }, m => { m.fk[0].regola = 'SET NULL'; }, m => { m.trigger[0].totale = 1; }];
    for (const cambia of mutazioni) { const m = metadati(); cambia(m); assert.throws(() => A.verificaMetadati(m), /^Error: SCHEMA_/); }
});
test('snapshot equivalente: diverso ordine di righe e proprietà, stessi PK/FK/impronte', () => {
    const a = iniziale(), b = copia(a); b.utente.reverse();
    b.utente[0] = { impronta: b.utente[0].impronta, id: b.utente[0].id };
    assert.deepEqual(A.normalizza(a), A.normalizza(b));
});
test('serializzazione proposta: NULL, vuoto, delimitatori, Unicode, spazi e colonne non collidono', () => {
    const codifica = v => v === null ? 'N;' : `V${Buffer.byteLength(v)}:${Buffer.from(v).toString('hex').toUpperCase()};`;
    const valori = [null, '', 'N;', ':;', 'è', 'e', 'a', 'a '];
    assert.equal(new Set(valori.map(codifica)).size, valori.length);
    assert.notEqual(codifica('ab') + codifica('c'), codifica('a') + codifica('bc'));
    assert.equal(codifica('è'), 'V2:C3A8;');
    assert.ok(!tabs.some(t => A.snapshotSQL(t, true).includes('JSON_ARRAY')));
    assert.ok(A.snapshotSQL('sessioni', true).includes("%Y-%m-%dT%H:%i:%s.%f"));
    // Confronto mysql2/MySQL effettivo rinviato al piano read-only.
});
test('allowlist statica: tutte e sole le DELETE esatte per PK, nessuna INSERT nell’adapter', () => {
    assert.deepEqual(tabs.map(t => A.deletes[t]), tabs.map(t => `DELETE FROM ${t} WHERE ${SCHEMA[t].pk.map(c => `${c} = ?`).join(' AND ')}`));
    const fs = require('node:fs'); const source = fs.readFileSync(require.resolve('./helpers/adapterMysqlRegistro'), 'utf8');
    assert.ok(!/\b(?:INSERT|UPDATE\s+\w+\s+SET|LIKE|JSON_ARRAY)\b/.test(source.replace(/\/\/[^\n]*/g, '')));
    assert.ok(!/globalThis\.fetch|require\(['"]mysql2|require\(['"].*aiuto|require\(['"].*preparaAmbiente/.test(source));
    for (const oggetto of [A.COLONNE, A.ORDINE, A.selezioni, A.deletes, A.SQL]) assert.ok(Object.isFrozen(oggetto));
});
test('inventario colonne/tipi corrisponde agli init SQL versionati senza eseguire SQL', () => {
    const fs = require('node:fs'), path = require('node:path');
    const dir = path.resolve(__dirname, '../db/init');
    const sql = fs.readdirSync(dir).filter(f => f.endsWith('_schema.sql')).sort()
        .map(f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '')).join('\n');
    const inventario = {};
    const tipo = x => x.toLowerCase() === 'boolean' ? 'tinyint' : x.toLowerCase();
    for (const m of sql.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\) ENGINE=/g)) {
        inventario[m[1]] = [...m[2].matchAll(/^\s*(\w+)\s+(INT|VARCHAR|TEXT|CHAR|ENUM|DATE|TIME|DATETIME|TIMESTAMP|DECIMAL|BOOLEAN)\b/gm)]
            .map(x => `${x[1]}:${tipo(x[2])}`);
    }
    for (const m of sql.matchAll(/ALTER TABLE (\w+)([\s\S]*?);/g)) {
        for (const x of m[2].matchAll(/ADD COLUMN (\w+)\s+(\w+)/g)) inventario[m[1]].push(`${x[1]}:${tipo(x[2])}`);
    }
    assert.deepEqual(Object.keys(inventario).sort(), tabs.slice().sort());
    for (const t of tabs) assert.equal(inventario[t].join(' '), A.COLONNE[t]);
    // Parser solo per inventario DDL offline; nessuna interpretazione di INSERT.
});
