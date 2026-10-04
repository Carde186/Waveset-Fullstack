// HTTP/ruoli/cookie/CSRF reali, persistenza mockata; nessuna sessione creata nel DB.
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const { hashToken } = require('../src/autenticazione/token');
const { generaCsrf } = require('../src/autenticazione/csrf');
const token = 'b'.repeat(64), device = '12345678-1234-4234-8234-123456789abc';
let server, base, ruolo, queries, guasto, pendente;
const evento = { id: 1, titolo: 'Evento test', data_evento: '2027-10-09', ora_evento: null, luogo: 'Club', citta: 'Roma', latitudine: 41, longitudine: 12,
    fonte: 'ticketmaster', stato: 'scartato', motivo_revisione: null, decisione_finale: 'rifiuta', tentativi: 1, generazione: 1, motivazione: 'Attraction incoerente.', errore: null, valutato_at: '2026-10-04T10:00:00Z' };
const db = { async query(sql, v = []) {
    queries.push(sql);
    if (sql.includes('FROM sessioni')) return [[{ id: 10, utente_id: 3, hash_token: hashToken(token), valida: 1, ruolo }]];
    if (guasto) throw new Error('SQL e dati interni riservati');
    if (sql.includes('SELECT ea.evento_id')) return [[{ evento_id: 1, id: 5, nome: 'Carl Cox', id_ticketmaster: 'carl', id_attraction_ticketmaster: 'carl' }]];
    if (sql.includes('FROM ollama_evento_audit')) return [[{ id: 1, evento_id: 1, artista_id: 5, generazione: 1, tentativo: 1, modello: 'qwen3:4b', confidenza: '.95', motivazione: 'Attraction incoerente.', decisione_modello: 'rifiuta', decisione_applicata: 'rifiuta' }]];
    if (sql.includes('FROM evento e LEFT JOIN')) return [v.length && Number(v[0]) !== 1 ? [] : [{ ...evento }]];
    if (sql.includes('SELECT id FROM evento')) return [Number(v[0]) === 1 ? [{ id: 1 }] : []];
    if (sql.includes('FROM ticketmaster_evento_fonte')) return [[{ snapshot: { id_esterno: 'tm' }, protetto_admin: false, modifiche_fonte: false }]];
    if (sql.startsWith('UPDATE') || sql.startsWith('INSERT')) { pendente = true; return [{ affectedRows: 1 }]; }
    throw new Error('Query inattesa');
}, async getConnection() { return { query: db.query.bind(db), async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} }; } };
const dbPath = require.resolve('../src/config/database'); require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const creaApp = require('../src/app');
before(async () => { const limiter = { prenota: () => ({ consentito: true }) }; const app = creaApp({ configurazioneWeb: { abilitata: true, origini: new Set(['http://localhost:5174']) }, limitatoreAccount: limiter, limitatoreRegistrazione: limiter }); server = await new Promise(r => { const s = app.listen(0,'127.0.0.1',()=>r(s)); }); base=`http://127.0.0.1:${server.address().port}/api/admin/eventi`; });
beforeEach(()=>{ruolo='ADMIN';queries=[];guasto=false;pendente=false;});
after(async()=>{await new Promise(r=>server.close(r));});
async function chiama(path, metodo='GET', headers={}) { const r=await fetch(base+path,{method:metodo,headers:{Cookie:`waveset_sid=${device}.${token}`,Origin:'http://localhost:5174','X-CSRF-Token':generaCsrf(token),...headers}});return {status:r.status,dati:await r.json().catch(()=>null),headers:r.headers}; }
test('registro conserva decisioni finali, motivazione/confidenza/modello e audit dettaglio',async()=>{
 const r=await chiama('/registro');assert.equal(r.status,200);assert.equal(r.dati[0].valutazione.decisione,'rifiuta');assert.equal(r.dati[0].valutazione.confidenza,.95);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await chiama('/1')).dati.audit[0].modello,'qwen3:4b');assert.equal((await chiama('/coda')).status,200);
});
test('rivalutazione 202 rimette in attesa senza approvare; ID inesistente 404',async()=>{assert.equal((await chiama('/1/rivaluta','POST')).status,202);assert(pendente);assert.equal((await chiama('/99/rivaluta','POST')).status,404);assert(!queries.some(q=>q.includes("SET e.stato = 'pubblicato'")));});
test('azioni manuali legacy disattivate senza mutazioni',async()=>{for(const path of ['/1/approva','/1/scarta','/1/rifiuta','/1/artisti/5/conferma-collegamento'])assert.equal((await chiama(path,'POST')).status,410);assert.equal((await chiama('/1','PATCH')).status,410);assert.equal(pendente,false);});
test('ospite e USER vietati a registro/dettaglio/rivalutazione',async()=>{for(const [path,method] of [['/registro','GET'],['/1','GET'],['/1/rivaluta','POST']]){assert.equal((await chiama(path,method,{Cookie:''})).status,401);ruolo='USER';assert.equal((await chiama(path,method)).status,403);ruolo='ADMIN';}assert.equal(pendente,false);});
test('CSRF e origine errata non avviano job',async()=>{assert.equal((await chiama('/1/rivaluta','POST',{'X-CSRF-Token':''})).status,403);assert.equal((await chiama('/1/rivaluta','POST',{Origin:'https://estraneo.test'})).status,403);assert.equal(pendente,false);});
test('ID invalidi rifiutati prima del DB, dettaglio assente 404',async()=>{for(const id of ['0','abc','-1','01','2147483648'])assert.equal((await chiama('/'+id+'/rivaluta','POST')).status,400);assert.equal((await chiama('/99')).status,404);});
test('errori DB non rivelano dati interni nei log o nelle risposte',async t=>{guasto=true;const log=[];t.mock.method(console,'error',(...v)=>log.push(v.join(' ')));for(const [path,metodo] of [['/registro','GET'],['/1/rivaluta','POST']]){const r=await chiama(path,metodo);assert.equal(r.status,500);assert(!JSON.stringify(r.dati).includes('riservati'));}assert(!log.join(' ').includes('riservati'));});
