// Solo waveset_test; fonti simulate e fixture ripulite per ID.
require('./preparaAmbiente');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const pool = require('../src/config/database');
const { creaRepository } = require('../src/artistiProvider/repository');
const { creaService } = require('../src/artistiProvider/service');
const { creaRepository: creaJob, rivaluta } = require('../src/ollama/repository');
const { configurazione } = require('../src/ollama/configurazione');
const { creaClient } = require('../src/ollama/client');
const { applicaDecisione } = require('../src/ollama/decisione');
const { ciclo } = require('../src/ollama/worker');
const { SOLO_PUBBLICATI } = require('../src/utilita/eventi');
test('identità Ticketmaster: omonimi, conferma atomica, rivalutazione, audit e concorrenza', async t => {
    const artisti=[], tag=randomUUID(), nome='Identità fixture '+tag;
    const ids=['a','b','c'].map(v=>'tm-'+v+'-'+tag);let evento;
    const repository=creaRepository(pool,'deezer');
    const esito={stato:'trovato',attractions:ids.map(id=>({id,name:nome})),ambiguo:true,controllatoAt:new Date().toISOString()};
    const client={async dettaglio(id){return {externalId:id,name:nome,provider:'deezer',storefront:'',fan:null,artwork:null,genres:[],
        url:'https://www.deezer.com/artist/'+id,syncedAt:new Date().toISOString(),raw:{id}};}};
    const service=creaService({repository,client,controllaTicketmaster:async()=>esito});
    const config=configurazione({OLLAMA_URL:'http://localhost:11434',OLLAMA_MODEL:'qwen3:4b'});
    const ollama=creaClient(config,async(_url,opts)=>{
        const schema=JSON.parse(opts.body).format, ramo=schema.anyOf?.[0]??schema;
        return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({decisione:ramo.properties.decisione.enum[0],
            confidenza:1,artista_corrispondente:true,possibile_duplicato:false,motivazione:ramo.properties.motivazione.enum[0]})}}));
    });
    ollama.pronto=async()=>({pronto:true});
    try{
        const [[db]]=await pool.query('SELECT DATABASE() nome');assert.equal(db.nome,'waveset_test');
        for(let n=0;n<2;n++){
            const [r]=await pool.query('INSERT INTO artista(nome,bio) VALUES(?,?)',[nome,'Bio curata']);artisti.push(r.insertId);
            await service.collega(r.insertId,{external_id:'9'+Date.now()+n,versione_attesa:null});
        }
        const [e]=await pool.query("INSERT INTO evento(titolo,data_evento,luogo,citta,fonte,id_esterno,stato) VALUES(?,'2090-10-15',?,'Toronto','ticketmaster',?,'da_valutare')",['In The Toronto Round fixture',tag,tag]);evento=e.insertId;
        await pool.query('INSERT INTO evento_artista(evento_id,artista_id,id_attraction_ticketmaster) VALUES(?,?,?)',[evento,artisti[0],ids[0]]);
        await pool.query("INSERT INTO ticketmaster_evento_fonte(evento_id,snapshot,stato_fonte,ultimo_controllo) VALUES(?,?,'onsale',UTC_TIMESTAMP(3))",[evento,JSON.stringify({attractions:[{id:ids[0],nome}],data_incerta:false})]);
        const jobs=creaJob(pool,config), pronti=jobs.pronti;jobs.pronti=async()=>(await pronti()).filter(j=>j.evento_id===evento);
        await t.test('omonimia rifiutata prima della conferma',async()=>{
            assert.equal((await ciclo({repository:jobs,client:ollama,config})).rifiuta,1);
        });
        const [storico]=await pool.query('SELECT * FROM ollama_evento_audit WHERE evento_id=? ORDER BY id',[evento]);
        await t.test('conferma disambigua, rimette in valutazione e pubblica solo dopo Ollama',async()=>{
            const r=await service.confermaTicketmaster(artisti[0],{attraction_id:ids[0],attraction_attesa:null,versione_attesa:1});
            assert.equal(r.ticketmaster.attractionConfermata,ids[0]);assert.equal(r.ticketmaster.ambiguo,true);
            const [[prima]]=await pool.query('SELECT stato FROM evento WHERE id=?',[evento]);assert.equal(prima.stato,'da_valutare');
            assert.equal((await ciclo({repository:jobs,client:ollama,config})).approva,1);
            const [pubblici]=await pool.query(`SELECT e.id FROM evento e WHERE e.id=? AND ${SOLO_PUBBLICATI}`,[evento]);assert.equal(pubblici.length,1);
            const [[job]]=await pool.query('SELECT generazione,tentativi FROM ollama_evento_job WHERE evento_id=?',[evento]);assert.equal(job.generazione,2);assert.equal(job.tentativi,1);
            const [dopo]=await pool.query('SELECT * FROM ollama_evento_audit WHERE evento_id=? AND generazione=1 ORDER BY id',[evento]);assert.deepEqual(dopo,storico);
            const [[artista]]=await pool.query('SELECT nome,bio FROM artista WHERE id=?',[artisti[0]]);assert.equal(artista.nome,nome);assert.equal(artista.bio,'Bio curata');
        });
        await t.test('rimozione e riconferma prima del worker rivalutano anche con gli stessi dati',async()=>{
            const [[prima]]=await pool.query('SELECT * FROM ollama_evento_job WHERE evento_id=?',[evento]);
            await service.confermaTicketmaster(artisti[0],{attraction_id:null,attraction_attesa:ids[0],versione_attesa:1});
            await service.confermaTicketmaster(artisti[0],{attraction_id:ids[0],attraction_attesa:null,versione_attesa:1});
            const [[pendente]]=await pool.query('SELECT * FROM ollama_evento_job WHERE evento_id=?',[evento]);
            assert.equal(pendente.stato,'da_valutare');assert.equal(pendente.input_hash,null);
            assert.equal(pendente.generazione,prima.generazione+2);assert.equal(pendente.tentativi,0);
            const [nascosti]=await pool.query(`SELECT e.id FROM evento e WHERE e.id=? AND ${SOLO_PUBBLICATI}`,[evento]);assert.equal(nascosti.length,0);
            await jobs.riconcilia();
            const [[riconciliato]]=await pool.query('SELECT input_hash,generazione FROM ollama_evento_job WHERE evento_id=?',[evento]);
            assert.equal(riconciliato.input_hash,prima.input_hash);assert.equal(riconciliato.generazione,pendente.generazione);
            assert.equal((await ciclo({repository:jobs,client:ollama,config})).approva,1);
        });
        await t.test('risposta in volo non si applica dopo rimozione e riconferma della stessa identità',async()=>{
            await rivaluta(pool,evento);await jobs.riconcilia();
            const inputs=await jobs.input(evento), pronto=(await jobs.pronti()).find(j=>j.evento_id===evento);
            const prenotato=await jobs.prenota(pronto,inputs);assert.ok(prenotato);
            const risposta=await ollama.valuta(inputs[0]);
            await service.confermaTicketmaster(artisti[0],{attraction_id:null,attraction_attesa:ids[0],versione_attesa:1});
            await service.confermaTicketmaster(artisti[0],{attraction_id:ids[0],attraction_attesa:null,versione_attesa:1});
            assert.equal(await jobs.termina(prenotato,inputs,[{...applicaDecisione(inputs[0],risposta.risposta,config.soglia),...risposta}]),'obsoleto');
            const [[j]]=await pool.query('SELECT stato,generazione,tentativi FROM ollama_evento_job WHERE evento_id=?',[evento]);
            assert.equal(j.stato,'da_valutare');assert.equal(j.generazione,prenotato.generazione+2);assert.equal(j.tentativi,0);
            const [[audit]]=await pool.query('SELECT errore,decisione_applicata FROM ollama_evento_audit WHERE id=?',[prenotato.auditIds[0]]);
            assert.equal(audit.errore,'OLLAMA_INPUT_CAMBIATO');assert.equal(audit.decisione_applicata,'da_valutare');
            assert.equal((await ciclo({repository:jobs,client:ollama,config})).approva,1);
        });
        await t.test('ripetere la conferma corrente non riavvia una valutazione completata',async()=>{
            const [[prima]]=await pool.query('SELECT * FROM ollama_evento_job WHERE evento_id=?',[evento]);
            await service.confermaTicketmaster(artisti[0],{attraction_id:ids[0],attraction_attesa:ids[0],versione_attesa:1});
            const [[dopo]]=await pool.query('SELECT * FROM ollama_evento_job WHERE evento_id=?',[evento]);assert.deepEqual(dopo,prima);
            const [pubblici]=await pool.query(`SELECT e.id FROM evento e WHERE e.id=? AND ${SOLO_PUBBLICATI}`,[evento]);assert.equal(pubblici.length,1);
        });
        await t.test('identità occupata: rollback senza cambiare il secondo artista',async()=>{
            await assert.rejects(service.confermaTicketmaster(artisti[1],{attraction_id:ids[0],attraction_attesa:null,versione_attesa:1}),e=>e.codice==='TICKETMASTER_GIA_COLLEGATO');
            assert.equal((await service.leggi(artisti[1])).collegamento.ticketmaster.attractionConfermata,null);
        });
        await t.test('nome locale cambiato durante il ricontrollo non conferma una relazione obsoleta',async()=>{
            const tardivo=creaService({repository,client,controllaTicketmaster:async()=>{
                await pool.query('UPDATE artista SET nome=? WHERE id=?',['Altro artista',artisti[0]]);return esito;
            }});
            try{
                await assert.rejects(tardivo.confermaTicketmaster(artisti[0],{attraction_id:ids[1],attraction_attesa:ids[0],versione_attesa:1}),e=>e.codice==='TICKETMASTER_IDENTITA_INVALIDA');
                assert.equal((await service.leggi(artisti[0])).collegamento.ticketmaster.attractionConfermata,ids[0]);
            }finally{await pool.query('UPDATE artista SET nome=? WHERE id=?',[nome,artisti[0]]);}
        });
        await t.test('scelte concorrenti: un successo e un conflitto; ripetizione idempotente e rimozione',async()=>{
            const esiti=await Promise.allSettled(ids.slice(1).map(id=>service.confermaTicketmaster(artisti[0],{attraction_id:id,attraction_attesa:ids[0],versione_attesa:1})));
            assert.equal(esiti.filter(e=>e.status==='fulfilled').length,1);
            assert.equal(esiti.find(e=>e.status==='rejected').reason.codice,'TICKETMASTER_CONFLITTO');
            const confermata=esiti.find(e=>e.status==='fulfilled').value.ticketmaster.attractionConfermata;
            await service.confermaTicketmaster(artisti[0],{attraction_id:confermata,attraction_attesa:ids[0],versione_attesa:1});
            await service.confermaTicketmaster(artisti[0],{attraction_id:null,attraction_attesa:confermata,versione_attesa:1});
            assert.equal((await service.leggi(artisti[0])).collegamento.ticketmaster.attractionConfermata,null);
        });
    }finally{
        if(evento)await pool.query('DELETE FROM evento WHERE id=?',[evento]);
        if(artisti.length)await pool.query('DELETE FROM artista WHERE id IN (?)',[artisti]);
        await pool.end();
    }
});
