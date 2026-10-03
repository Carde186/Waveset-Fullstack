const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizza } = require('../src/ticketmaster/normalizza');
const { configurazione } = require('../src/ticketmaster/configurazione');
const { creaClientTicketmaster, ErroreTicketmaster } = require('../src/servizi/ticketmaster');
const { sincronizza } = require('../src/ticketmaster/sincronizza');
const { conBlocco } = require('../src/ticketmaster/repository');
const { avviaScheduler } = require('../src/ticketmaster/scheduler');
const { statoPubblico } = require('../src/ticketmaster/stato');
const { eseguiJob } = require('../src/ticketmaster/job');
const artisti = [{ id: 1, nome: 'Nome locale', id_ticketmaster: 'id-confermato' }, { id: 2, nome: 'Altro', id_ticketmaster: null }];
const evento = (patch = {}) => ({ id: 'evt-1', name: 'Concerto', dates: { start: { localDate: '2027-03-10', localTime: '21:30' }, status: { code: 'onsale' } },
    _embedded: { attractions: [{ id: 'id-confermato', name: 'Nome cambiato' }], venues: [{ name: 'Club', city: { name: 'Milano' }, location: { latitude: '45.123456789', longitude: '0' } }] }, ...patch });
const config = configurazione({ TICKETMASTER_API_KEY: 'fixture' });
const adesso = new Date('2026-10-03T10:00:00Z');

test('parsing: data/ora locali, precisione coordinate, zero valido e ID confermato con nome cambiato', () => {
    const e = normalizza(evento(), artisti);
    assert.equal(e.campi.data_evento, '2027-03-10'); assert.equal(e.campi.ora_evento, '21:30:00');
    assert.equal(e.campi.latitudine, 45.123457); assert.equal(e.campi.longitudine, 0);
    assert.deepEqual(e.lineup, [{ artista_id: 1, id_attraction_ticketmaster: 'id-confermato', confermato: true }]);
});
test('mapping: solo locali, nomi esatti candidati, ID confermato prevale, attrazioni ambigue escluse', () => {
    const e = normalizza(evento({ _embedded: { attractions: [{ id: 'altro-id', name: 'Nome locale' }, { id: 'candidato', name: ' altro ' }, { id: 'live', name: 'Artista Apple esterno' }] } }), artisti);
    assert.deepEqual(e.lineup, [{ artista_id: 2, id_attraction_ticketmaster: 'candidato', confermato: false }]);
    const ambiguo = normalizza(evento({ _embedded: { attractions: [{ id: 'a', name: 'Altro' }, { id: 'b', name: 'Altro' }] } }), artisti);
    assert.deepEqual(ambiguo.lineup, []);
    const omonimi = normalizza(evento({ _embedded: { attractions: [{ id: 'a', name: 'Altro' }] } }), [...artisti, { id: 3, nome: 'Altro', id_ticketmaster: null }]);
    assert.deepEqual(omonimi.lineup, []);
    const giaConfermato = normalizza(evento({ _embedded: { attractions: [{ id: 'id-confermato', name: 'Altro' }] } }), artisti);
    assert.deepEqual(giaConfermato.lineup.map(a => a.artista_id), [1]);
});
test('date impossibili, orari fuori range, coordinate malformate e campi opzionali assenti', () => {
    const e = normalizza(evento({ dates: { start: { localDate: '2027-02-30', localTime: '25:10' }, status: { code: 'canceled' } }, _embedded: { venues: [{ location: { latitude: 'NaN', longitude: '181' } }] } }), artisti);
    assert.equal(e.campi.data_evento, null); assert.equal(e.campi.ora_evento, null); assert.equal(e.campi.latitudine, null); assert.equal(e.campi.longitudine, null); assert.equal(e.stato_fonte, 'canceled');
    assert.equal(normalizza({ id: '../malformato' }, artisti), null);
    assert.equal(normalizza(evento({ _embedded: { attractions: 'errato' } }), artisti), null);
});
test('stati Ticketmaster e date TBA/TBD sono preservati, senza inventare date', () => {
    for (const code of ['onsale', 'offsale', 'canceled', 'postponed', 'rescheduled']) assert.equal(normalizza(evento({ dates: { status: { code }, start: { dateTBD: true } } }), artisti).stato_fonte, code);
    assert.equal(normalizza(evento({ dates: { start: { dateTBA: true } } }), artisti).data_incerta, true);
});
test('configurazione: intervallo/default, disabilitazione, limiti validati senza valori riservati', () => {
    assert.equal(config.intervalloMs, 28800000); assert.equal(configurazione({}).configurata, false);
    assert.equal(configurazione({ TICKETMASTER_SYNC_ENABLED: 'false' }).attiva, false);
    for (const raw of ['0', '-1', 'abc', '21']) assert.throws(() => configurazione({ TICKETMASTER_SYNC_MAX_PAGES: raw }), /TICKETMASTER_SYNC_MAX_PAGES/);
});
function clientFinto(resposte, opzioni = {}) {
    const chiamate = [], pause = []; let clock = 0;
    const client = creaClientTicketmaster({ chiave: 'chiave-fittizia-solo-test', ora: () => clock,
        attendi: async ms => { pause.push(ms); clock += ms; }, fetchImpl: async (url, opts) => {
            chiamate.push({ url: new URL(url), signal: opts.signal, ms: clock });
            const r = resposte.shift(); if (r instanceof Error) throw r; return r;
        }, ...opzioni });
    return { client, chiamate, pause };
}
const risposta = (dati, status = 200, headers = {}) => new Response(JSON.stringify(dati), { status, headers });
test('paginazione, deduplica per ID, futuro e una sola modalità di ricerca con pacing condiviso', async () => {
    const a = evento(), b = evento({ id: 'evt-2' });
    const { client, chiamate } = clientFinto([risposta({ _embedded: { events: [a] }, page: { totalPages: 2 } }), risposta({ _embedded: { events: [a, b] }, page: { totalPages: 2 } })]);
    const r = await client.cercaPagine({ attractionId: 'id-confermato', keyword: 'Ignorato', da: adesso.toISOString() });
    assert.equal(r.completa, true); assert.deepEqual(r.eventi.map(e => e.id), ['evt-1', 'evt-2']);
    assert.equal(chiamate[0].url.searchParams.has('keyword'), false); assert.equal(chiamate[0].url.searchParams.get('attractionId'), 'id-confermato');
    assert.equal(chiamate[1].url.searchParams.get('page'), '1'); assert(chiamate[1].ms - chiamate[0].ms >= 300);
});
test('limite pagine segnala troncamento; budget limita anche retry/dettagli', async () => {
    const { client } = clientFinto([risposta({ _embedded: { events: [evento()] }, page: { totalPages: 10 } })], { maxPagine: 1, maxRichieste: 1 });
    assert.equal((await client.cercaPagine({ keyword: 'Nome' })).completa, false);
    await assert.rejects(() => client.recuperaEvento('evt-1'), /BUDGET_RICHIESTE/);
});
test('retry su 500/429, Retry-After, 401 definitivo e messaggi senza URL/chiavi', async () => {
    const { client, chiamate, pause } = clientFinto([risposta({}, 500), risposta({}, 429, { 'retry-after': '2' }), risposta({ page: { totalPages: 0 } })]);
    assert.equal((await client.cercaPagine({ keyword: 'Nome' })).completa, true); assert.equal(chiamate.length, 3); assert(pause.includes(2000));
    const bad = clientFinto([risposta({ fault: { detail: 'chiave-fittizia-solo-test' } }, 401)]);
    await assert.rejects(() => bad.client.cercaPagine({ keyword: 'Nome' }), e => e.message === 'Ticketmaster: HTTP_401'); assert.equal(bad.chiamate.length, 1);
});
test('chiave mancante non chiama la rete; errore rete è sanitizzato; 404 dettaglio legittimo', async () => {
    const assente = clientFinto([], { chiave: '' }); await assert.rejects(() => assente.client.cercaPagine({ keyword: 'Nome' }), /CHIAVE_ASSENTE/); assert.equal(assente.chiamate.length, 0);
    const guasto = clientFinto([new Error('URL con chiave-fittizia-solo-test')], { tentativi: 0 }); await assert.rejects(() => guasto.client.cercaPagine({ keyword: 'Nome' }), e => e.message === 'Ticketmaster: RETE_TIMEOUT');
    const missing = clientFinto([risposta({}, 404)]); assert.equal(await missing.client.recuperaEvento('evt-1'), null);
});
test('JSON/pagina malformata non è interpretata come elenco vuoto completo', async () => {
    for (const dati of [null, [], {}, { page: { totalElements: 2, totalPages: 1 } }, { _embedded: { events: 'no' } }, { page: { totalPages: -1 } }]) {
        const { client } = clientFinto([risposta(dati)]); await assert.rejects(() => client.cercaPagine({ keyword: 'Nome' }), /RISPOSTA_NON_VALIDA/);
    }
});
test('timeout reale del segnale e arresto sono sanitizzati; Retry-After HTTP-date viene rispettato', async () => {
    const client = creaClientTicketmaster({ chiave: 'fixture', tentativi: 0, timeoutMs: 10, pausaMs: 0,
        fetchImpl: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
    // AbortSignal.timeout non mantiene vivo Node da solo.
    const timer = setTimeout(() => {}, 100);
    try { await assert.rejects(() => client.cercaPagine({ keyword: 'Nome' }), /RETE_TIMEOUT/); } finally { clearTimeout(timer); }
    const controller = new AbortController(); controller.abort();
    const spento = clientFinto([], { signal: controller.signal });
    await assert.rejects(() => spento.client.cercaPagine({ keyword: 'Nome' }), /INTERROTTO/); assert.equal(spento.chiamate.length, 0);
    const rate = clientFinto([risposta({}, 429, { 'retry-after': new Date(3600000).toUTCString() })]);
    await assert.rejects(() => rate.client.cercaPagine({ keyword: 'Nome' }), e => e.retrySec === 3600);
    assert.equal(rate.chiamate.length, 1);
});
function fixtureSync() {
    const salvati = new Map(), esiti = [], assenti = [];
    let stato = { fallimenti: 0, prossimo_tentativo: null };
    const locali = structuredClone(artisti);
    const repository = {
        stato: async () => stato,
        artisti: async () => locali,
        salva: async e => { const nuovo = !salvati.has(e.id_esterno); salvati.set(e.id_esterno, e); return nuovo ? 'pubblicati' : 'aggiornati'; },
        noti: async id => [...salvati.values()].filter(e => e.lineup.some(a => a.artista_id === id)).map((e, i) => ({ id: i + 1, id_esterno: e.id_esterno })),
        assente: async id => assenti.push(id),
        esitoArtista: async (a, ora, prossimo, errore) => { a.prossimo_tentativo = prossimo; a.fallimenti = errore ? (a.fallimenti ?? 0) + 1 : 0; esiti.push({ id: a.id, errore }); },
        esitoCiclo: async (ora, r) => { stato = { fallimenti: r.fallimentiGlobali, prossimo_tentativo: r.prossimo }; },
    };
    const client = { cercaPagine: async ({ attractionId }) => ({ eventi: attractionId ? [evento()] : [], completa: true }), recuperaEvento: async () => null, richieste: () => 2 };
    const esegui = opts => sincronizza({ repository, client, config, adesso, ...opts });
    return { repository, client, locali, salvati, esiti, assenti, esegui };
}
test('sincronizzazione idempotente e cache persistente: nessuna chiamata prima della scadenza', async () => {
    const f = fixtureSync(); await f.esegui(); assert.equal(f.salvati.size, 1);
    f.client.cercaPagine = async () => { throw Error('Non deve essere chiamato'); };
    assert.equal((await f.esegui()).esito, 'cache');
    f.client.cercaPagine = async () => ({ eventi: [evento()], completa: true }); await f.esegui({ forza: true }); assert.equal(f.salvati.size, 1);
});
test('dopo otto ore e tra visite distanti una settimana il calendario cambia automaticamente', async () => {
    const f = fixtureSync(); await f.esegui(); let chiamate = 0;
    f.client.cercaPagine = async ({ attractionId }) => {
        chiamate++; return { eventi: attractionId ? [evento(), evento({ id: 'evt-nuovo' })] : [], completa: true };
    };
    assert.equal((await f.esegui({ adesso: new Date(adesso.getTime() + config.intervalloMs - 1) })).esito, 'cache');
    assert.equal(chiamate, 0);
    await f.esegui({ adesso: new Date(adesso.getTime() + 7 * 86400000) });
    assert.equal(chiamate, 2); assert.equal(f.salvati.size, 2);
});
test('job disabilitato o senza chiave non acquisisce connessioni e non chiama la fonte', async () => {
    const pool = { getConnection: () => assert.fail('nessun DB') };
    const client = { cercaPagine: () => assert.fail('nessuna rete') };
    assert.deepEqual(await eseguiJob({ pool, client, env: {} }), { esito: 'disabilitato', motivo: 'CHIAVE_ASSENTE' });
    assert.equal((await eseguiJob({ pool, client, env: { TICKETMASTER_API_KEY: 'fixture', TICKETMASTER_SYNC_ENABLED: 'false' } })).motivo, 'DISATTIVATO');
});
test('evento modificato e annullato aggiornano la fonte; assenza conservata e dettaglio consultato', async () => {
    const f = fixtureSync(); await f.esegui();
    f.client.cercaPagine = async () => ({ eventi: [evento({ name: 'Nuovo titolo', dates: { start: { localDate: '2027-04-10' }, status: { code: 'canceled' } } })], completa: true });
    await f.esegui({ forza: true }); assert.equal(f.salvati.get('evt-1').campi.titolo, 'Nuovo titolo'); assert.equal(f.salvati.get('evt-1').stato_fonte, 'canceled');
    f.client.cercaPagine = async () => ({ eventi: [], completa: true }); await f.esegui({ forza: true }); assert(f.assenti.length > 0); assert.equal(f.salvati.size, 1);
});
test('pagina troncata/errore: non marca assenze, usa backoff e conserva i dati', async () => {
    const f = fixtureSync(); await f.esegui();
    f.client.cercaPagine = async () => ({ eventi: [], completa: false }); const r = await f.esegui({ forza: true });
    assert.equal(r.esito, 'errore'); assert.equal(f.assenti.length, 0); assert.equal(f.salvati.size, 1); assert(r.prossimo > adesso);
    assert.equal((await f.esegui()).esito, 'cache');
});
test('401/429 arrestano il lotto; global backoff rispetta Retry-After', async () => {
    const f = fixtureSync(); f.client.cercaPagine = async () => { throw new ErroreTicketmaster('HTTP_429', 3600); };
    const r = await f.esegui(); assert.equal(r.artisti, 1); assert(r.prossimo.getTime() >= adesso.getTime() + 3600000);
});
test('solo artisti locali, lotto limitato e filtro futuro, nessuna associazione esterna inventata', async () => {
    const f = fixtureSync(); await assert.rejects(() => f.esegui({ ids: [999] }), /ARTISTA_LOCALE_ASSENTE/);
    f.client.cercaPagine = async () => ({ eventi: [evento({ dates: { start: { localDate: '2020-01-01' } } }), evento({ _embedded: { attractions: [{ id: 'esterno', name: 'Non locale' }] } })], completa: true });
    const r = await f.esegui({ config: { ...config, maxArtisti: 1 } }); assert.equal(r.esito, 'parziale'); assert.equal(f.salvati.size, 0);
});
test('GET_LOCK condiviso: secondo esecutore occupato, rilascio anche su errore', async () => {
    let preso = false, release = 0;
    const pool = { getConnection: async () => ({ query: async sql => {
        if (sql.includes('DATABASE()')) return [[{ nome: 'db-test' }]];
        if (sql.includes('GET_LOCK')) { const acquisito = preso ? 0 : 1; preso = true; return [[{ acquisito }]]; }
        if (sql.includes('RELEASE_LOCK')) { preso = false; release++; }
        return [[]];
    }, release() {} }) };
    let termina; const attesa = new Promise(r => { termina = r; });
    const primo = conBlocco(pool, async () => { await attesa; throw Error('guasto'); });
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(await conBlocco(pool, () => assert.fail('non entrare')), { esito: 'occupato' });
    termina(); await assert.rejects(() => primo, /guasto/); assert.equal(release, 1); assert.equal(preso, false);
});
test('scheduler: avvio automatico, nessuna sovrapposizione, arresto e log sanitizzati', async () => {
    const timers = [], logs = []; let termina, chiamate = 0;
    const scheduler = avviaScheduler({ pianifica: (cb, ms) => { timers.push({ cb, ms }); return timers.length; }, annulla() {},
        esegui: async () => { chiamate++; await new Promise(r => { termina = r; }); throw Error('URL apikey=riservata'); }, registra: (...args) => logs.push(args) });
    assert.equal(timers[0].ms, 0); const avvio = timers[0].cb(); assert.equal(chiamate, 1); assert.equal(timers.length, 1);
    termina(); await avvio; assert.equal(timers.length, 2); assert.equal(timers[1].ms, 60000);
    assert(!JSON.stringify(logs).includes('riservata')); await scheduler.ferma(); await timers[1].cb(); assert.equal(chiamate, 1);
});
test('stato pubblico: dati vecchi/fonte indisponibile; nessun dettaglio tecnico o chiave', async () => {
    const pool = { query: async () => [[{ ultimo_successo: '2026-10-01T00:00:00Z', ultimo_tentativo: '2026-10-03T09:00:00Z', esito: 'errore', errore: 'HTTP_500' }]] };
    const s = await statoPubblico(pool, { TICKETMASTER_API_KEY: 'segreto-fixture' }, adesso);
    assert.equal(s.dati_vecchi, true); assert.equal(s.errore_temporaneo, true); assert.equal(s.ultimo_successo, '2026-10-01T00:00:00Z');
    assert(!JSON.stringify(s).includes('segreto-fixture')); assert(!JSON.stringify(s).includes('HTTP_500'));
});
