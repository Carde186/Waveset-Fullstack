'use strict';
const assert = require('node:assert/strict');

// Nessun pool, ambiente, parser SQL, fetch globale o default verso un DB.
// L'adapter futuro deve fornire snapshot con PK/FK e impronta di tutti i
// campi della riga iniziale, senza restituire valori di segreti.
const SCHEMA = Object.freeze({
    genere: { pk: ['id'], fk: {} },
    artista: { pk: ['id'], fk: {} },
    album: { pk: ['id'], fk: { artista_id: 'artista' } },
    brano: { pk: ['id'], fk: { artista_id: 'artista', album_id: 'album' } },
    utente: { pk: ['id'], fk: {} },
    playlist: { pk: ['id'], fk: { utente_id: 'utente' } },
    evento: { pk: ['id'], fk: {} },
    sessioni: { pk: ['id'], fk: { utente_id: 'utente' } },
    artista_genere: { pk: ['artista_id', 'genere_id'], fk: { artista_id: 'artista', genere_id: 'genere' } },
    playlist_brano: { pk: ['playlist_id', 'brano_id'], fk: { playlist_id: 'playlist', brano_id: 'brano' } },
    evento_artista: { pk: ['evento_id', 'artista_id'], fk: { evento_id: 'evento', artista_id: 'artista' } },
    utente_artista: { pk: ['utente_id', 'artista_id'], fk: { utente_id: 'utente', artista_id: 'artista' } },
});
for (const descrizione of Object.values(SCHEMA)) {
    Object.freeze(descrizione.pk); Object.freeze(descrizione.fk); Object.freeze(descrizione);
}
const ORDINE = ['playlist_brano', 'evento_artista', 'artista_genere', 'utente_artista',
    'sessioni', 'playlist', 'brano', 'album', 'evento', 'artista', 'genere', 'utente'];
const copia = valore => structuredClone(valore);
const chiave = (t, r) => `${t}:${JSON.stringify(SCHEMA[t].pk.map(c => r[c]))}`;
const campi = t => [...new Set([...SCHEMA[t].pk, ...Object.keys(SCHEMA[t].fk)])];
const selezioni = Object.fromEntries(Object.keys(SCHEMA).map(t => [t,
    `SELECT ${campi(t).join(', ')} FROM ${t} FOR UPDATE`]));
function indicizza(stato) {
    const m = new Map();
    for (const t of Object.keys(SCHEMA)) {
        assert.ok(Array.isArray(stato[t]), `Snapshot incompleto: ${t}`);
        for (const r of stato[t]) {
            for (const c of SCHEMA[t].pk) assert.ok(Number.isSafeInteger(r[c]) && r[c] > 0, 'PK snapshot non valida');
            for (const c of Object.keys(SCHEMA[t].fk)) {
                assert.ok(Object.hasOwn(r, c), 'FK snapshot mancante');
                assert.ok((r[c] === null && t === 'brano' && c === 'album_id') ||
                    (Number.isSafeInteger(r[c]) && r[c] > 0), 'FK snapshot non valida');
            }
            const ammessi = [...campi(t), 'impronta'];
            assert.ok(Object.keys(r).every(c => ammessi.includes(c)), 'Snapshot con campi non ammessi');
            assert.ok(typeof r.impronta === 'string' && r.impronta.length === 64, 'Impronta completa richiesta');
            const k = chiave(t, r);
            assert.ok(!m.has(k), 'PK duplicata nello snapshot');
            m.set(k, { t, r: copia(r) });
        }
    }
    return m;
}

function creaRegistro(iniziale) {
    const base = indicizza(iniziale);
    const create = new Map();
    const pendenti = new Set();
    let prossimo = 0;
    let fallita = false;
    function registra(t, r) {
        assert.ok(SCHEMA[t], 'Tabella non ammessa');
        for (const c of SCHEMA[t].pk) assert.ok(Number.isSafeInteger(r[c]) && r[c] > 0, 'PK non valida');
        for (const c of Object.keys(SCHEMA[t].fk)) {
            assert.ok(Object.hasOwn(r, c), `FK non dichiarata: ${c}`);
            assert.ok((r[c] === null && t === 'brano' && c === 'album_id') ||
                (Number.isSafeInteger(r[c]) && r[c] > 0), 'FK non valida');
        }
        const k = chiave(t, r);
        assert.ok(!base.has(k), 'Riga iniziale non cancellabile');
        assert.ok(!create.has(k), 'PK duplicata nel registro');
        // Proprietà acquisite esclusivamente dalla chiamata esplicita del test.
        create.set(k, { t, r: Object.fromEntries(campi(t).map(c => [c, r[c]])), stato: 'attiva' });
    }
    function registraId(t, esito, fk = {}) {
        assert.ok(SCHEMA[t]?.pk.length === 1, 'Usare registraAssociazione per PK composte');
        assert.equal(esito.affectedRows, 1, 'INSERT singola non dimostrata');
        registra(t, { ...fk, id: esito.insertId });
    }
    function registraDa201(t, risposta, id, fk = {}) {
        assert.equal(risposta.status, 201, 'Creazione HTTP non dimostrata');
        assert.ok(SCHEMA[t]?.pk.length === 1, 'ID numerico richiesto');
        registra(t, { ...fk, id });
    }
    function registraAssociazione(t, esito, pk) {
        assert.ok(SCHEMA[t]?.pk.length === 2, 'PK composta richiesta');
        assert.equal(esito.affectedRows, 1, 'Associazione nuova non dimostrata');
        registra(t, pk);
    }
    function segnaAssente(t, pk, motivo) {
        assert.ok(['rollback-importatore', 'delete-api-verificata'].includes(motivo), 'Motivo assenza non ammesso');
        const voce = create.get(chiave(t, pk));
        assert.equal(voce?.stato, 'attiva', 'ID non registrato o non attivo');
        voce.stato = 'assente';
    }
    function pianifica(stato, t, ids) {
        assert.ok(!fallita, 'Pulizia già fallita: serve revisione');
        assert.equal(pendenti.size, 0, 'Operazione ambigua/incompleta: pulizia non autorizzata');
        const attuale = indicizza(stato);
        const piano = new Set();
        if (t !== undefined) {
            assert.ok(SCHEMA[t]?.pk.length === 1 && Array.isArray(ids) && ids.length > 0, 'Selezione intermedia non valida');
            assert.equal(new Set(ids).size, ids.length, 'PK duplicate nella selezione');
            for (const id of ids) {
                assert.ok(Number.isSafeInteger(id) && id > 0, 'PK non valida');
                const k = chiave(t, { id });
                assert.ok(!base.has(k), 'Riga iniziale non cancellabile');
                assert.equal(create.get(k)?.stato, 'attiva', 'ID non registrato o non attivo');
                piano.add(k);
            }
        } else for (const [k, v] of create) if (v.stato === 'attiva') piano.add(k);
        // Espansione soltanto delle dipendenze GIÀ registrate, mai dal delta.
        let cambia;
        do {
            cambia = false;
            for (const [k, v] of create) if (v.stato === 'attiva' && !piano.has(k)) {
                if (Object.entries(SCHEMA[v.t].fk).some(([c, padre]) => piano.has(chiave(padre, { id: v.r[c] })))) {
                    piano.add(k); cambia = true;
                }
            }
        } while (cambia);
        for (const [k, v] of base) assert.deepEqual(attuale.get(k), v, 'Riga iniziale modificata o assente');
        for (const [k, v] of attuale) {
            if (base.has(k)) continue;
            const registrata = create.get(k);
            const dipende = Object.entries(SCHEMA[v.t].fk).some(([c, padre]) => piano.has(chiave(padre, { id: v.r[c] })));
            assert.ok(registrata, dipende ? 'Dipendenza non registrata' : 'Riga non registrata: nessuna attribuzione dal delta');
            assert.equal(registrata.stato, 'attiva', 'Riga dichiarata assente o già pulita ancora presente');
            assert.deepEqual(Object.fromEntries(campi(v.t).map(c => [c, v.r[c]])), registrata.r, 'Riferimenti fixture modificati');
        }
        for (const [k, v] of create) {
            assert.equal(attuale.has(k), v.stato === 'attiva', 'Assenza/presenza fixture non dimostrata');
            for (const [c, padre] of Object.entries(SCHEMA[v.t].fk)) if (v.stato === 'attiva' && v.r[c] !== null) {
                assert.ok(attuale.has(chiave(padre, { id: v.r[c] })), 'Padre non presente');
            }
        }
        const righe = ORDINE.flatMap(tab => [...piano].filter(k => create.get(k).t === tab).map(k => ({ k, ...copia(create.get(k)) })));
        return {
            righe,
            conteggi: Object.fromEntries(ORDINE.map(tab => [tab, righe.filter(v => v.t === tab).length])),
            select: copia(selezioni),
            atteso: new Map([...attuale].filter(([k]) => !piano.has(k))),
        };
    }
    async function pulisci(adapter, t, ids) {
        assert.ok(!fallita, 'Pulizia già fallita: serve revisione');
        let aperta = false;
        try {
            await adapter.beginTransaction(); aperta = true;
            const prima = await adapter.leggiStato(copia(selezioni));
            const piano = pianifica(prima, t, ids);
            await adapter.salvaAnteprima({ righe: piano.righe.map(v => ({ tabella: v.t, pk: SCHEMA[v.t].pk.map(c => v.r[c]) })), conteggi: piano.conteggi });
            for (const v of piano.righe) {
                const sql = `DELETE FROM ${v.t} WHERE ${SCHEMA[v.t].pk.map(c => `${c} = ?`).join(' AND ')}`;
                const [esito] = await adapter.query(sql, SCHEMA[v.t].pk.map(c => v.r[c]));
                assert.equal(esito.affectedRows, 1, 'Conteggio DELETE inatteso');
            }
            const dopo = indicizza(await adapter.leggiStato(copia(selezioni)));
            assert.deepEqual(dopo, piano.atteso, 'Stato/conteggi inattesi prima del COMMIT');
            await adapter.commit(); aperta = false;
            for (const v of piano.righe) create.get(v.k).stato = 'pulita';
            return copia(piano.conteggi);
        } catch (e) {
            fallita = true;
            if (aperta) await adapter.rollback();
            throw e;
        }
    }
    async function conOperazione(azione, identifica) {
        const id = ++prossimo; pendenti.add(id);
        // L'identificatore sicuro dell'operazione esiste PRIMA della richiesta.
        // Nessuna modifica globale: azione/identifica sono dipendenze locali.
        // Se azione o identifica lanciano, l'operazione rimane pendente.
        // Non serve ripristino in finally: non è installato alcun wrapper globale.
        const risposta = await azione();
        await identifica(risposta, { registraId, registraDa201, registraAssociazione });
        pendenti.delete(id);
        return risposta;
    }
    return { registraId, registraDa201, registraAssociazione, segnaAssente, pianifica, pulisci, conOperazione };
}
module.exports = { creaRegistro, SCHEMA };
