// API ADMIN reali e DB test; credenziali solo fixture del seed, ripulite da aiuto.
const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {db,UTENTE_ADMIN,UTENTE_A,accedi,chiama,chiudi}=require('./aiuto');
let admin,user,id;
before(async()=>{admin=await accedi(UTENTE_ADMIN);user=await accedi(UTENTE_A);const [e]=await db.query("INSERT INTO evento(titolo,data_evento,fonte,id_esterno,stato) VALUES('Ollama API fixture','2090-01-01','ticketmaster',?,'scartato')",[randomUUID()]);id=e.insertId;await db.query("INSERT INTO ollama_evento_job(evento_id,stato,tentativi,motivazione) VALUES(?,'rifiuta',1,'Attraction incoerente')",[id]);});
after(async()=>{if(id)await db.query('DELETE FROM evento WHERE id=?',[id]);await chiudi();});
test('ADMIN legge registro e dettaglio valutazione',async()=>{const r=await chiama('/admin/eventi/registro',{sessione:admin});assert.equal(r.stato,200);assert(r.dati.some(e=>e.id===id));const d=await chiama('/admin/eventi/'+id,{sessione:admin});assert.equal(d.dati.valutazione.decisione,'rifiuta');});
test('rivaluta idempotente, nessuna approvazione manuale o pubblicazione',async()=>{for(let n=0;n<2;n++)assert.equal((await chiama(`/admin/eventi/${id}/rivaluta`,{metodo:'POST',sessione:admin})).stato,202);const [[j]]=await db.query('SELECT generazione,stato FROM ollama_evento_job WHERE evento_id=?',[id]);assert.equal(j.generazione,2);assert.equal(j.stato,'da_valutare');assert.equal((await chiama(`/eventi/${id}`)).stato,404);for(const azione of ['approva','scarta','rifiuta'])assert.equal((await chiama(`/admin/eventi/${id}/${azione}`,{metodo:'POST',sessione:admin})).stato,410);});
test('ospite/USER non possono rivalutare né leggere il registro',async()=>{assert.equal((await chiama('/admin/eventi/registro')).stato,401);assert.equal((await chiama(`/admin/eventi/${id}/rivaluta`,{metodo:'POST',sessione:user})).stato,403);});
