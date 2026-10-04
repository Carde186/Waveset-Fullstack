// MySQL test reale, HTTP Ollama finto. Solo fixture temporanee, ripulite per ID.
require('./preparaAmbiente');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
const pool = require('../src/config/database');
const { applicaSchema } = require('../src/ollama/schema');
const { creaRepository, rivaluta } = require('../src/ollama/repository');
const { preparaInput, hash } = require('../src/ollama/input');
const { ciclo, esegui } = require('../src/ollama/worker');
const { configurazione } = require('../src/ollama/configurazione');
const { ErroreOllama } = require('../src/ollama/client');
const { SOLO_PUBBLICATI, formattaEventi } = require('../src/utilita/eventi');
const config = configurazione({ OLLAMA_URL: 'http://localhost:11434', OLLAMA_MODEL: 'qwen3:4b' });
const risposta = { decisione: 'approva', confidenza: .95, artista_corrispondente: true, possibile_duplicato: false, motivazione: 'Attraction coincidente.' };
test('Ollama MySQL: migrazione idempotente, audit, pubblicazione, retry, lock, rivalutazione e fonte preservata', async t => {
    let artista, c, server, base; const eventi = []; const tag = randomUUID();
    try {
        c = await pool.getConnection();
        const [[lock]] = await c.query("SELECT GET_LOCK('waveset_test:ollama-eventi',0) acquisito"); assert.equal(lock.acquisito, 1, 'fermare il worker Ollama durante i test DB');
        await applicaSchema(pool); await applicaSchema(pool);
        const [a] = await pool.query('INSERT INTO artista(nome) VALUES(?)', ['Ollama fixture ' + tag]); artista = a.insertId;
        const nome = 'Ollama fixture ' + tag;
        const [l] = await pool.query(`INSERT INTO artista_provider_link(artista_id,provider,external_id,storefront,url,dati_normalizzati_json,raw_json,sincronizzato_at)
            VALUES(?,'deezer',?,'','https://www.deezer.com/artist/1',?,'{}',UTC_TIMESTAMP(3))`, [artista, tag, JSON.stringify({ name: nome, externalId: tag })]);
        await pool.query("INSERT INTO artista_ticketmaster_presenza(link_id,external_id,storefront,esito_json,controllato_at) VALUES(?,?,'',?,UTC_TIMESTAMP(3))",
            [l.insertId, tag, JSON.stringify({ stato: 'trovato', ambiguo: false, attractions: [{ id: tag, name: nome }] })]);
        async function crea(suffisso, luogo = 'Venue '+tag) {
            const [e] = await pool.query("INSERT INTO evento(titolo,data_evento,luogo,citta,latitudine,longitudine,fonte,id_esterno,stato) VALUES(?,'2090-06-01',?,'Roma',41,12,'ticketmaster',?,'da_valutare')", ['Ollama fixture '+suffisso, luogo, tag+suffisso]);
            eventi.push(e.insertId);
            await pool.query('INSERT INTO evento_artista(evento_id,artista_id,id_attraction_ticketmaster) VALUES(?,?,?)', [e.insertId, artista, tag]);
            await pool.query("INSERT INTO ticketmaster_evento_fonte(evento_id,snapshot,stato_fonte,ultimo_controllo) VALUES(?,?,'onsale',UTC_TIMESTAMP(3))",
                [e.insertId, JSON.stringify({ id_esterno: tag+suffisso, attractions: [{ id:tag, nome }], data_incerta:false })]);
            const inputs = await preparaInput(pool, e.insertId);
            await pool.query('INSERT INTO ollama_evento_job(evento_id,input_hash) VALUES(?,?)', [e.insertId, hash(inputs, config.modello)]);
            return e.insertId;
        }
        const repo = creaRepository(pool, config); repo.riconcilia = async () => {};
        const basePronti = repo.pronti; repo.pronti = async () => (await basePronti()).filter(j => eventi.includes(j.evento_id));
        const client = { pronto: async () => true, valuta: async () => ({ raw: JSON.stringify(risposta), risposta }) };
        const app = express(); app.use('/api', require('../src/routes/eventi'));
        server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
        base = `http://127.0.0.1:${server.address().port}/api`;
        const primo = await crea('a');
        await t.test('approvato pubblico, audit completo, seconda esecuzione nessuna inferenza', async () => {
            assert.equal((await ciclo({repository:repo,client,config})).approva,1);
            const [pubblici] = await pool.query(`SELECT e.* FROM evento e WHERE e.id=? AND ${SOLO_PUBBLICATI}`, [primo]); assert.equal(pubblici.length,1); assert.equal((await formattaEventi(pubblici))[0].lineup[0].id,artista);
            const [[audit]] = await pool.query('SELECT * FROM ollama_evento_audit WHERE evento_id=?',[primo]); assert.equal(audit.modello,'qwen3:4b'); assert.equal(audit.decisione_applicata,'approva'); assert.equal(audit.decisione_modello,'approva'); assert(audit.input_hash); assert(audit.risposta_raw); assert(audit.completato_at);
            assert.equal((await ciclo({repository:repo,client,config})).controllati,0);
            const pubbliciHttp = await (await fetch(base+'/eventi?filtro=tutti')).json(); assert(pubbliciHttp.some(e=>e.id===primo));
            assert.equal((await fetch(base+'/eventi/'+primo)).status,200);
            await assert.rejects(pool.query('INSERT INTO ollama_evento_job(evento_id) VALUES(?)',[primo]),e=>e.code==='ER_DUP_ENTRY');
        });
        await t.test('duplicato DB rifiutato, stesso modello approva non aggira il controllo',async()=>{
            const doppio=await crea('b'); assert.equal((await ciclo({repository:repo,client,config})).rifiuta,1);
            const [visibili]=await pool.query(`SELECT e.id FROM evento e WHERE e.id=? AND ${SOLO_PUBBLICATI}`,[doppio]); assert.equal(visibili.length,0); assert.equal((await fetch(base+'/eventi/'+doppio)).status,404);
        });
        await t.test('stessa data/venue senza artista in comune è comunque un duplicato potenziale',async()=>{
            const luogo='Venue altro artista '+tag;
            const [m]=await pool.query("INSERT INTO evento(titolo,data_evento,luogo,citta) VALUES('Fixture manuale altra lineup','2090-06-01',?,'Roma')",[luogo]);eventi.push(m.insertId);
            const nuovo=await crea('altra-lineup',luogo);
            const [v]=await preparaInput(pool,nuovo);assert(v.eventiRilevanti.some(e=>e.id===m.insertId));
            assert.equal((await ciclo({repository:repo,client,config})).rifiuta,1);
        });
        await t.test('errore tecnico pendente, backoff, terzo tentativo rifiutato, audit 3 righe',async()=>{
            const errore=await crea('c','Retry '+tag); const fallisce={pronto:async()=>true,valuta:async()=>{throw new ErroreOllama('OLLAMA_TIMEOUT');}};
            for(let n=1;n<=3;n++) { if(n>1) await pool.query('UPDATE ollama_evento_job SET prossimo_tentativo=UTC_TIMESTAMP(3) WHERE evento_id=?',[errore]); const r=await ciclo({repository:repo,client:fallisce,config}); assert.equal(r[n===3?'rifiuta':'da_valutare'],1); }
            const [[j]]=await pool.query('SELECT * FROM ollama_evento_job WHERE evento_id=?',[errore]); assert.equal(j.tentativi,3); assert.equal(j.errore,'OLLAMA_TIMEOUT');
            const [[n]]=await pool.query('SELECT COUNT(*) n FROM ollama_evento_audit WHERE evento_id=?',[errore]); assert.equal(n.n,3);
        });
        await t.test('rivalutazione conserva snapshot/audit, nasconde pubblico e richieste ripetute idempotenti',async()=>{
            const [[prima]]=await pool.query('SELECT snapshot FROM ticketmaster_evento_fonte WHERE evento_id=?',[primo]);
            assert(await rivaluta(pool,primo)); assert(await rivaluta(pool,primo));
            const [[j]]=await pool.query('SELECT * FROM ollama_evento_job WHERE evento_id=?',[primo]); assert.equal(j.generazione,2); assert.equal(j.tentativi,0);
            const [pubblici]=await pool.query(`SELECT e.id FROM evento e WHERE e.id=? AND ${SOLO_PUBBLICATI}`,[primo]); assert.equal(pubblici.length,0);
            const [[dopo]]=await pool.query('SELECT snapshot FROM ticketmaster_evento_fonte WHERE evento_id=?',[primo]); assert.deepEqual(dopo.snapshot,prima.snapshot);
            assert.equal((await esegui(pool,client,config)).esito,'occupato');
            assert.equal((await ciclo({repository:repo,client,config})).approva,1);
        });
        await t.test('input cambiato durante inferenza non pubblicato',async()=>{
            const cambiato=await crea('d','Cambia '+tag);
            const modifica={pronto:async()=>true,valuta:async()=>{await pool.query('UPDATE evento SET titolo=? WHERE id=?',['Modificato',cambiato]);return {raw:JSON.stringify(risposta),risposta};}};
            assert.equal((await ciclo({repository:repo,client:modifica,config})).obsoleto,1);
            const [[j]]=await pool.query('SELECT stato FROM ollama_evento_job WHERE evento_id=?',[cambiato]);assert.equal(j.stato,'da_valutare');
            const [[a]]=await pool.query('SELECT risposta_raw,decisione_modello,errore FROM ollama_evento_audit WHERE evento_id=?',[cambiato]);
            assert.equal(a.risposta_raw,JSON.stringify(risposta));assert.equal(a.decisione_modello,'approva');assert.equal(a.errore,'OLLAMA_INPUT_CAMBIATO');
        });
    }finally{
        if(server) await new Promise(r=>server.close(r));
        for(const id of eventi) await pool.query('DELETE FROM evento WHERE id=?',[id]);
        if(artista) await pool.query('DELETE FROM artista WHERE id=?',[artista]);
        if(c){await c.query("SELECT RELEASE_LOCK('waveset_test:ollama-eventi')");c.release();}
        await pool.end();
    }
});
