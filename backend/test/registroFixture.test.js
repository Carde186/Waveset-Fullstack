'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const { creaRegistro, SCHEMA } = require('./helpers/registroFixture');
const impronta = r => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
const sigilla = r => ({ ...r, impronta: impronta(r) });
const esito = id => ({ insertId: id, affectedRows: 1 });
const pk = (t, r) => JSON.stringify(SCHEMA[t].pk.map(c => r[c]));
function statoIniziale() {
    const s = Object.fromEntries(Object.keys(SCHEMA).map(t => [t, []]));
    s.artista = [1, 3].map(id => sigilla({ id }));
    s.genere = [sigilla({ id: 10 })];
    s.utente = [1, 2, 3].map(id => sigilla({ id }));
    s.artista_genere = [sigilla({ artista_id: 1, genere_id: 10 })];
    s.utente_artista = [1, 3].map(artista_id => sigilla({ utente_id: 1, artista_id }));
    return s;
}
function scenario() {
    const base = statoIniziale();
    const registro = creaRegistro(base);
    const s = structuredClone(base);
    const id = (t, n, fk = {}) => { registro.registraId(t, esito(n), fk); s[t].push(sigilla({ id: n, ...fk })); };
    const coppia = (t, r) => { registro.registraAssociazione(t, { affectedRows: 1 }, r); s[t].push(sigilla(r)); };
    id('artista', 100); id('artista', 101);
    id('genere', 200); id('genere', 201);
    coppia('artista_genere', { artista_id: 100, genere_id: 200 });
    coppia('artista_genere', { artista_id: 100, genere_id: 10 });
    coppia('artista_genere', { artista_id: 101, genere_id: 201 });
    id('album', 300, { artista_id: 100 });
    id('brano', 400, { artista_id: 100, album_id: 300 });
    id('playlist', 500, { utente_id: 1 });
    coppia('playlist_brano', { playlist_id: 500, brano_id: 400 });
    id('evento', 600);
    coppia('evento_artista', { evento_id: 600, artista_id: 100 });
    coppia('utente_artista', { utente_id: 1, artista_id: 100 });
    id('sessioni', 700, { utente_id: 1 });
    return { base, registro, s };
}
function adapterFinto(s, fallisciAl = 0) {
    let backup; let cancellazioni = 0;
    const chiamate = [];
    // Mappa di statement esatti: neppure il fake interpreta SQL con regex.
    const deleteSql = new Map(Object.entries(SCHEMA).map(([t, x]) => [
        `DELETE FROM ${t} WHERE ${x.pk.map(c => `${c} = ?`).join(' AND ')}`, t,
    ]));
    return {
        chiamate,
        async beginTransaction() { backup = structuredClone(s); chiamate.push('BEGIN'); },
        async leggiStato(select) {
            assert.equal(Object.keys(select).length, Object.keys(SCHEMA).length);
            for (const [t, sql] of Object.entries(select)) {
                const campi = [...new Set([...SCHEMA[t].pk, ...Object.keys(SCHEMA[t].fk)])];
                assert.equal(sql, `SELECT ${campi.join(', ')} FROM ${t} FOR UPDATE`);
            }
            chiamate.push('SELECT'); return structuredClone(s);
        },
        async salvaAnteprima(p) { chiamate.push({ anteprima: structuredClone(p) }); },
        async query(sql, valori) {
            const t = deleteSql.get(sql); assert.ok(t, 'Statement non previsto');
            chiamate.push({ sql, valori: [...valori] }); cancellazioni++;
            if (cancellazioni === fallisciAl) return [{ affectedRows: 0 }];
            const n = s[t].findIndex(r => pk(t, r) === JSON.stringify(valori));
            if (n === -1) return [{ affectedRows: 0 }];
            s[t].splice(n, 1); return [{ affectedRows: 1 }];
        },
        async commit() { chiamate.push('COMMIT'); },
        async rollback() {
            for (const t of Object.keys(s)) s[t] = structuredClone(backup[t]);
            chiamate.push('ROLLBACK');
        },
    };
}
const sqlIn = a => a.chiamate.filter(c => c.sql);

test('rifiuta PK numeriche e composite duplicate', () => {
    const { registro } = scenario();
    assert.throws(() => registro.registraId('artista', esito(100)), /PK duplicata/);
    assert.throws(() => registro.registraAssociazione('artista_genere', { affectedRows: 1 }, { artista_id: 100, genere_id: 200 }), /PK duplicata/);
});
test('una riga iniziale non può essere registrata o cancellata', async () => {
    const { registro, s } = scenario(); const a = adapterFinto(s);
    assert.throws(() => registro.registraId('artista', esito(1)), /Riga iniziale/);
    await assert.rejects(registro.pulisci(a, 'artista', [1]), /Riga iniziale/);
    assert.equal(sqlIn(a).length, 0); assert.equal(a.chiamate.at(-1), 'ROLLBACK');
});
test('ID non registrato: rollback prima della prima DELETE', async () => {
    const { registro, s } = scenario(); const a = adapterFinto(s);
    await assert.rejects(registro.pulisci(a, 'artista', [999]), /ID non registrato/);
    assert.equal(sqlIn(a).length, 0); assert.equal(a.chiamate.at(-1), 'ROLLBACK');
});
test('dipendenza non registrata: nessuna acquisizione dal delta', async () => {
    const { registro, s } = scenario(); s.album.push(sigilla({ id: 999, artista_id: 100 }));
    const a = adapterFinto(s);
    await assert.rejects(registro.pulisci(a, 'artista', [100]), /Dipendenza non registrata/);
    assert.equal(sqlIn(a).length, 0); assert.equal(a.chiamate.at(-1), 'ROLLBACK');
});
test('riga estranea non collegata: non diventa fixture dal delta', async () => {
    const { registro, s } = scenario(); s.genere.push(sigilla({ id: 999 })); const a = adapterFinto(s);
    await assert.rejects(registro.pulisci(a), /Riga non registrata/);
    assert.equal(sqlIn(a).length, 0);
});
test('riga iniziale modificata con stessa PK: stop e rollback', async () => {
    const { registro, s } = scenario(); s.artista[0].impronta = impronta({ modifica: true }); const a = adapterFinto(s);
    await assert.rejects(registro.pulisci(a), /Riga iniziale modificata/);
    assert.equal(sqlIn(a).length, 0); assert.equal(a.chiamate.at(-1), 'ROLLBACK');
});
test('conteggio inatteso dopo una DELETE: rollback di tutta la transazione', async () => {
    const { registro, s } = scenario(); const prima = structuredClone(s); const a = adapterFinto(s, 2);
    await assert.rejects(registro.pulisci(a), /Conteggio DELETE inatteso/);
    assert.deepEqual(s, prima); assert.equal(sqlIn(a).length, 2);
    assert.ok(!a.chiamate.includes('COMMIT')); assert.equal(a.chiamate.at(-1), 'ROLLBACK');
    await assert.rejects(registro.pulisci(a), /Pulizia già fallita/);
});
test('pulisci artista 100 elimina solo i suoi figli registrati, senza genitori/altre fixture', async () => {
    const { registro, s } = scenario(); const a = adapterFinto(s);
    const conteggi = await registro.pulisci(a, 'artista', [100]);
    assert.equal(conteggi.artista, 1); assert.equal(conteggi.artista_genere, 2);
    assert.equal(conteggi.album, 1); assert.equal(conteggi.brano, 1);
    assert.equal(conteggi.playlist_brano, 1); assert.equal(conteggi.evento_artista, 1); assert.equal(conteggi.utente_artista, 1);
    for (const t of ['genere', 'utente', 'playlist', 'evento', 'sessioni']) assert.equal(conteggi[t], 0);
    assert.deepEqual(s.artista.map(r => r.id), [1, 3, 101]);
    assert.deepEqual(s.genere.map(r => r.id), [10, 200, 201]);
    assert.deepEqual(s.utente_artista.map(r => [r.utente_id, r.artista_id]), [[1, 1], [1, 3]]);
    assert.equal(a.chiamate.at(-1), 'COMMIT');
});
test('pulisci genere 201 non cancella artista 101 o altri generi', async () => {
    const { registro, s } = scenario(); const a = adapterFinto(s);
    const conteggi = await registro.pulisci(a, 'genere', [201]);
    assert.equal(conteggi.genere, 1); assert.equal(conteggi.artista_genere, 1);
    assert.equal(conteggi.artista, 0); assert.equal(conteggi.album, 0);
    assert.deepEqual(s.artista.map(r => r.id), [1, 3, 100, 101]);
    assert.deepEqual(s.genere.map(r => r.id), [10, 200]);
});
test('pulizia finale dopo le due intermedie riporta esattamente alla baseline', async () => {
    const { registro, s, base } = scenario(); const a = adapterFinto(s);
    await registro.pulisci(a, 'artista', [100]); await registro.pulisci(a, 'genere', [201]);
    const conti = await registro.pulisci(a);
    assert.equal(conti.artista, 1); assert.equal(conti.genere, 1);
    assert.equal(conti.sessioni, 1); assert.equal(conti.playlist, 1); assert.equal(conti.evento, 1);
    assert.deepEqual(s, base); assert.equal(a.chiamate.filter(c => c === 'COMMIT').length, 3);
});
test('solo WHERE su tutte le colonne PK: nessuna DELETE per email/nome/LIKE/device/delta', async () => {
    const { registro, s } = scenario(); const a = adapterFinto(s); await registro.pulisci(a);
    for (const { sql, valori } of sqlIn(a)) {
        const t = Object.keys(SCHEMA).find(t => sql === `DELETE FROM ${t} WHERE ${SCHEMA[t].pk.map(c => `${c} = ?`).join(' AND ')}`);
        assert.ok(t); assert.equal(valori.length, SCHEMA[t].pk.length);
        assert.ok(valori.every(Number.isSafeInteger));
        for (const proibito of ['email', 'nome', 'LIKE', 'device', 'prefisso', ' BETWEEN ', ' IN ']) assert.ok(!sql.includes(proibito));
    }
});
test('preview precede le DELETE e seconda SELECT precede il COMMIT', async () => {
    const { registro, s } = scenario(); const a = adapterFinto(s); await registro.pulisci(a, 'genere', [201]);
    assert.deepEqual(a.chiamate.slice(0, 2), ['BEGIN', 'SELECT']);
    const anteprima = a.chiamate[2].anteprima;
    assert.deepEqual(anteprima.righe, [{ tabella: 'artista_genere', pk: [101, 201] }, { tabella: 'genere', pk: [201] }]);
    assert.deepEqual(a.chiamate.slice(-2), ['SELECT', 'COMMIT']);
});
test('registro non interpreta SQL e richiede esito di INSERT singola', () => {
    const r = creaRegistro(statoIniziale());
    assert.throws(() => r.registraId('artista', { insertId: 100, affectedRows: 2 }), /INSERT singola/);
    assert.throws(() => r.registraId('tabella_non_ammessa', esito(100)));
    assert.throws(() => r.registraAssociazione('artista_genere', { affectedRows: 0 }, { artista_id: 100, genere_id: 10 }), /Associazione nuova/);
});
test('riferimenti o padre modificati/non presenti fanno fallire la preview', () => {
    const { registro, s } = scenario(); s.album.find(r => r.id === 300).artista_id = 101;
    assert.throws(() => registro.pianifica(s), /Riferimenti fixture/);
    const altro = scenario(); altro.s.artista = altro.s.artista.filter(r => r.id !== 100);
    assert.throws(() => altro.registro.pianifica(altro.s), /Assenza\/presenza fixture|Padre non presente/);
});
test('rollback importatore/DELETE API: assenza esplicita verificata, non inferita', async () => {
    const { registro, s } = scenario(); registro.segnaAssente('sessioni', { id: 700 }, 'delete-api-verificata');
    s.sessioni = []; const a = adapterFinto(s); const conti = await registro.pulisci(a);
    assert.equal(conti.sessioni, 0); assert.equal(sqlIn(a).filter(c => c.sql.includes('sessioni')).length, 0);
});
test('marcare assente una riga ancora presente non autorizza pulizia', async () => {
    const { registro, s } = scenario(); registro.segnaAssente('sessioni', { id: 700 }, 'delete-api-verificata');
    const a = adapterFinto(s); await assert.rejects(registro.pulisci(a), /ancora presente/); assert.equal(sqlIn(a).length, 0);
});
test('identificazione HTTP avviene prima del ritorno al chiamante, senza installare fetch globale', async () => {
    const prima = globalThis.fetch; const r = creaRegistro(statoIniziale()); let chiamate = 0;
    const fetchLocale = async () => { chiamate++; return { status: 201, clone: () => ({ json: async () => ({ utente: { id: 100 } }) }) }; };
    const risposta = await r.conOperazione(fetchLocale, async (risposta, registro) => {
        const dati = await risposta.clone().json(); registro.registraDa201('utente', risposta, dati.utente.id);
    });
    assert.equal(risposta.status, 201); assert.equal(chiamate, 1); assert.equal(globalThis.fetch, prima);
    assert.throws(() => r.registraId('utente', esito(100)), /PK duplicata/);
});
test('errore HTTP o corpo perso: operazione ambigua, rollback e zero DELETE, fetch globale identico', async () => {
    for (const corpoPerso of [false, true]) {
        const prima = globalThis.fetch; const { registro, s } = scenario();
        await assert.rejects(registro.conOperazione(async () => {
            if (!corpoPerso) throw new Error('rete simulata'); return { status: 201 };
        }, async () => { throw new Error('corpo simulato indisponibile'); }));
        assert.equal(globalThis.fetch, prima);
        const a = adapterFinto(s); await assert.rejects(registro.pulisci(a), /ambigua\/incompleta/);
        assert.equal(sqlIn(a).length, 0); assert.equal(a.chiamate.at(-1), 'ROLLBACK');
    }
});
test('snapshot con campi personali/segreti non ammessi rifiutato', () => {
    const s = statoIniziale(); s.utente[0].email = 'valore-simulato';
    assert.throws(() => creaRegistro(s), /campi non ammessi/);
});

test('effetto collaterale rilevato dalla SELECT dopo DELETE: rollback prima del COMMIT', async () => {
    const { registro, s } = scenario(); const prima = structuredClone(s); const a = adapterFinto(s);
    const query = a.query;
    a.query = async (...args) => {
        const esito = await query(...args); s.utente[0].impronta = impronta({ mutazione: true }); return esito;
    };
    await assert.rejects(registro.pulisci(a, 'genere', [201]), /Stato\/conteggi inattesi/);
    assert.deepEqual(s, prima); assert.ok(!a.chiamate.includes('COMMIT'));
});

test('fallimento del setup dopo prima INSERT registrata: pulizia solo di quell’ID', async () => {
    const base = statoIniziale(); const s = structuredClone(base); const registro = creaRegistro(base);
    registro.registraId('artista', esito(100)); s.artista.push(sigilla({ id: 100 }));
    const a = adapterFinto(s); const conti = await registro.pulisci(a);
    assert.equal(conti.artista, 1); assert.equal(conti.album, 0); assert.equal(conti.brano, 0);
    assert.deepEqual(sqlIn(a), [{ sql: 'DELETE FROM artista WHERE id = ?', valori: [100] }]);
    assert.deepEqual(s, base);
});
test('INSERT con ID non ricevuto lascia operazione pendente e cleanup non autorizzato', async () => {
    const base = statoIniziale(); const s = structuredClone(base); const registro = creaRegistro(base);
    await assert.rejects(registro.conOperazione(async () => {
        s.artista.push(sigilla({ id: 100 })); return { insertId: 0, affectedRows: 1 };
    }, (esito, r) => r.registraId('artista', esito)), /PK non valida/);
    const a = adapterFinto(s); await assert.rejects(registro.pulisci(a), /ambigua\/incompleta/);
    assert.equal(sqlIn(a).length, 0); assert.equal(a.chiamate.at(-1), 'ROLLBACK');
});

test('registrazione HTTP richiede 201 e rifiuta ID seed o già registrati', () => {
    const r = creaRegistro(statoIniziale());
    assert.throws(() => r.registraDa201('utente', { status: 409 }, 100), /Creazione HTTP/);
    assert.throws(() => r.registraDa201('utente', { status: 201 }, 1), /Riga iniziale/);
    r.registraDa201('utente', { status: 201 }, 100);
    assert.throws(() => r.registraDa201('utente', { status: 201 }, 100), /PK duplicata/);
});
