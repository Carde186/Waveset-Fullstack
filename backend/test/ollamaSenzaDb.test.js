const assert = require('node:assert/strict');
const { test } = require('node:test');
const { configurazione } = require('../src/ollama/configurazione');
const { creaClient, validaRisposta, ErroreOllama } = require('../src/ollama/client');
const { applicaDecisione } = require('../src/ollama/decisione');
const { ciclo } = require('../src/ollama/worker');
const { schema, sistema, schemaPerInput } = require('../src/ollama/prompt');
const { hash } = require('../src/ollama/input');
const config = configurazione({ OLLAMA_URL: 'http://localhost:11434', OLLAMA_MODEL: 'qwen3:4b' });
const risposta = { decisione: 'approva', confidenza: .95, artista_corrispondente: true, possibile_duplicato: false, motivazione: 'Attraction ID e nome coincidenti.' };
const input = () => ({ artista: { id: 5, nome: 'Carl Cox', nomeProvider: 'Carl Cox', provider: 'deezer', providerExternalId: '3951' },
    verificaTicketmaster: { stato: 'trovato', omonimi: false, attractions: [{ id: 'carl', nome: 'Carl Cox' }], attractionConfermata: null },
    evento: { id: 'e1', titolo: 'Carl Cox', data: '2027-10-09', venue: 'Pacha', statoFonte: 'onsale', dataIncerta: false, attractions: [{ id: 'carl', nome: 'Carl Cox' }] }, eventiRilevanti: [] });
const http = v => new Response(JSON.stringify(v), { status: 200 });
test('configurazione obbligatoria, soglie e URL senza credenziali; modello configurabile', () => {
    for (const env of [{}, { OLLAMA_URL: 'not-url', OLLAMA_MODEL: 'qwen3:4b' }, { OLLAMA_URL: 'http://user:pass@localhost:11434', OLLAMA_MODEL: 'x' }, { OLLAMA_URL: config.url, OLLAMA_MODEL: 'x', OLLAMA_SOGLIA_CONFIDENZA: '2' }]) assert.throws(() => configurazione(env), /OLLAMA_CONFIGURAZIONE/);
    assert.equal(config.modello, 'qwen3:4b'); assert.equal(config.tentativi, 3);
});
test('HTTP mock: readiness, Structured Outputs, nessuna chiamata reale e approva sopra soglia', async () => {
    const richieste = [];
    const c = creaClient(config, async (url, opts) => { richieste.push({ url, opts }); return http(url.endsWith('/tags') ? { models: [{ name: config.modello }] } : { done: true, message: { content: JSON.stringify({ ...risposta, motivazione: JSON.parse(opts.body).format.properties.motivazione.enum[0] }) } }); });
    assert.equal((await c.pronto()).pronto, true);
    const r = await c.valuta(input()); assert.equal(applicaDecisione(input(), r.risposta, .85).decisione, 'approva');
    const corpo = JSON.parse(richieste[1].opts.body); assert.deepEqual(corpo.format, schemaPerInput(input())); assert.equal(corpo.stream, false); assert.equal(corpo.think, false); assert.equal(corpo.options.temperature, 0); assert.equal(corpo.tools, undefined);
    for (const testo of ['B2B', 'festival', 'omonimi', 'non_trovato', 'non_verificato']) assert(sistema.includes(testo));
});
for (const [caso, patch] of [['rifiuta', { decisione: 'rifiuta' }], ['sotto soglia', { confidenza: .84 }], ['duplicato modello', { possibile_duplicato: true }], ['artista non corrispondente', { artista_corrispondente: false }]]) test(caso, () => assert.equal(applicaDecisione(input(), { ...risposta, ...patch }, .85).decisione, 'rifiuta'));
for (const [caso, v] of [['JSON invalido', 'oops'], ['JSON nullo', 'null'], ['incompleto', JSON.stringify({ decisione: 'approva' })], ['enum invalido', JSON.stringify({ ...risposta, decisione: 'forse' })], ['confidenza fuori range', JSON.stringify({ ...risposta, confidenza: 1.01 })], ['tipo confidenza', JSON.stringify({ ...risposta, confidenza: '1' })], ['campo extra', JSON.stringify({ ...risposta, extra: true })], ['motivazione vuota', JSON.stringify({ ...risposta, motivazione: '' })], ['motivazione lunga', JSON.stringify({ ...risposta, motivazione: 'x'.repeat(401) })]]) test(caso, () => { assert.throws(() => validaRisposta(v), e => e.temporaneo === false); });
for (const titolo of ['HOT SAUCE ft. CARL COX, ERIC POWELL and MORE', 'Carl Cox B2B', 'Festival multi-artista', 'Haunted Superclub 2026', 'Omonimo']) test(`${titolo}: nome da solo non basta, attraction certa necessaria`, () => {
    const v = input(); v.evento.titolo = titolo; v.evento.attractions = [{ id: 'altro', nome: 'Carl Cox' }];
    assert.equal(applicaDecisione(v, risposta, .85).decisione, 'rifiuta');
    v.evento.attractions[0].id = 'carl'; assert.equal(applicaDecisione(v, risposta, .85).decisione, 'approva');
});
for (const stato of ['non_trovato', 'non_verificato']) test(stato, () => {
    const v = input(); v.verificaTicketmaster.stato = stato; assert.equal(applicaDecisione(v, risposta, .85).decisione, 'rifiuta');
    v.verificaTicketmaster.attractionConfermata = 'carl'; assert.equal(applicaDecisione(v, risposta, .85).decisione, 'approva');
});
test('omonimi, duplicati backend, dati insufficienti, generi assenti', () => {
    const v = input(); assert.equal(applicaDecisione(v, risposta, .85).decisione, 'approva');
    v.verificaTicketmaster.omonimi = true; assert.equal(applicaDecisione(v, risposta, .85).decisione, 'rifiuta');
    v.verificaTicketmaster.attractionConfermata = 'carl'; assert.equal(applicaDecisione(v, risposta, .85).decisione, 'approva');
    v.eventiRilevanti.push({ id: 2 }); assert.equal(applicaDecisione(v, risposta, .85).decisione, 'rifiuta');
    v.eventiRilevanti = []; v.evento.dataIncerta = true; assert.equal(applicaDecisione(v, risposta, .85).decisione, 'rifiuta');
});
for (const status of [404, 429, 500]) test(`HTTP ${status} mantiene errore tecnico ripetibile`, async () => { const c = creaClient(config, async () => new Response('', { status })); await assert.rejects(c.valuta(input()), e => e.temporaneo === true); });
test('rete, timeout e modello non disponibile', async () => {
    await assert.rejects(creaClient(config, async () => { throw new Error('rete'); }).valuta(input()), e => e.codice === 'OLLAMA_RETE');
    await assert.rejects(creaClient({ ...config, timeout: 5 }, async (_, o) => new Promise((r, j) => o.signal.addEventListener('abort', () => j(new Error())))).valuta(input()), e => e.codice === 'OLLAMA_TIMEOUT');
    await assert.rejects(creaClient(config, async () => http({ models: [{ name: 'altro' }] })).pronto(), e => e.codice === 'OLLAMA_MODELLO_NON_DISPONIBILE');
});
test('risposta assente o JSON esterno inatteso è rifiuto, non approvazione', async () => {
    for (const v of [{ done: true, message: { content: '' } }, { done: true, message: { content: '{}' } }, []]) await assert.rejects(creaClient(config, async () => http(v)).valuta(input()), e => e.temporaneo === false);
});
function memoria(n = 1) {
    const jobs = Array.from({ length: n }, (_, i) => ({ evento_id: i + 1, tentativi: 0, stato: 'da_valutare' }));
    const audit = [];
    return { jobs, audit, async riconcilia() {}, async pronti() { return jobs.filter(j => j.stato === 'da_valutare'); }, async input() { return [input()]; },
        async prenota(j) { j.tentativi++; return { ...j }; }, async termina(j, inputs, risultati) {
            const r = risultati[0]; const stato = r.decisione ?? (j.tentativi < 3 ? 'da_valutare' : 'rifiuta');
            audit.push({ ...r, stato, tentativo: j.tentativi }); jobs.find(v => v.evento_id === j.evento_id).stato = stato; return stato;
        } };
}
test('retry differito tre volte, audit e ultimo errore tecnico rifiutato', async () => {
    const repository = memoria(); const client = { pronto: async () => true, valuta: async () => { throw new ErroreOllama('OLLAMA_TIMEOUT'); } };
    for (let i = 0; i < 3; i++) await ciclo({ repository, client, config });
    assert.deepEqual(repository.audit.map(a => a.stato), ['da_valutare', 'da_valutare', 'rifiuta']);
    assert.equal((await ciclo({ repository, client, config })).controllati, 0);
});
test('idempotenza e concorrenza limitata; inferenze parallele con applicazione seriale', async () => {
    const repository = memoria(6); let inCorso = 0, massimo = 0, applicazioni = 0, maxApplicazioni = 0;
    const fine = repository.termina.bind(repository); repository.termina = async (...v) => { applicazioni++; maxApplicazioni = Math.max(maxApplicazioni, applicazioni); await new Promise(r => setTimeout(r, 2)); const esito = await fine(...v); applicazioni--; return esito; };
    const client = { pronto: async () => true, valuta: async () => { massimo = Math.max(massimo, ++inCorso); await new Promise(r => setTimeout(r, 5)); inCorso--; return { risposta, raw: JSON.stringify(risposta) }; } };
    await ciclo({ repository, client, config: { ...config, concorrenza: 2 } }); assert.equal(massimo, 2); assert.equal(maxApplicazioni, 1);
    assert.equal((await ciclo({ repository, client, config })).controllati, 0);
});
test('hash minimizzato ignora duplicati transitori ma rileva modifica identità/data/modello', () => {
    const v = input(), h = hash([v], config.modello); v.eventiRilevanti = [{ id: 2 }]; assert.equal(hash([v], config.modello), h);
    v.evento.data = '2027-10-10'; assert.notEqual(hash([v], config.modello), h);
});

test('normalizzazione conserva lettere non latine e non confonde identità diverse', () => {
    const { nome } = require('../src/ollama/decisione');
    assert.equal(nome('Cárl-Cox'), nome('Carl Cox'));
    assert.notEqual(nome('田中 DJ'), nome('山田 DJ'));
});

test('motivazione libera inventata non ammessa dal format causa rifiuto, anche con attraction certa', async () => {
    const c = creaClient(config, async () => http({ done: true, message: { content: JSON.stringify({ ...risposta, motivazione: 'Il titolo Haunted contiene Carl Cox.' }) } }));
    await assert.rejects(c.valuta(input()), e => e.codice === 'OLLAMA_MOTIVAZIONE_FUORI_SCHEMA' && e.temporaneo === false);
    const v = input(); v.evento.attractions = [];
    assert(!schemaPerInput(v).properties.motivazione.enum.some(m => m.includes('coerente con')));
});
