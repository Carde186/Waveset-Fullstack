const assert = require('node:assert/strict');
const { test } = require('node:test');
const { creaControllo, normalizzaNome } = require('../src/artistiProvider/presenzaTicketmaster');
const { creaClientTicketmaster } = require('../src/servizi/ticketmaster');
const { creaService } = require('../src/artistiProvider/service');
const { providerAttivo } = require('../src/artistiProvider/configurazione');
const { ErroreProvider } = require('../src/artistiProvider/errore');
const { creaRepository: creaBase } = require('../src/artistiProvider/repositoryProfilo');
test('Provider: Deezer unico provider; configurazioni ritirate o sconosciute rifiutate', () => {
    assert.equal(providerAttivo({}), 'deezer');
    assert.equal(providerAttivo({ ARTISTI_PROVIDER: 'deezer' }), 'deezer');
    for (const provider of ['apple_music', 'spotify']) {
        assert.throws(() => providerAttivo({ ARTISTI_PROVIDER: provider }), e => e.codice === 'PROVIDER_CONFIGURAZIONE');
        assert.throws(() => creaBase({}, provider), e => e.codice === 'PROVIDER_CONFIGURAZIONE');
        assert.throws(() => creaService({ provider, repository: {}, client: {}, controllaTicketmaster: async () => {} }), e => e.codice === 'PROVIDER_CONFIGURAZIONE');
    }
});
test('Ticketmaster: confronto esatto normalizzato, omonimi espliciti e deduplicazione ID', async () => {
    assert.equal(normalizzaNome('Chárlotte-de Witte!'), normalizzaNome('Charlotte de Witte'));
    const controllo = creaControllo({ ora: () => 0, client: { async cercaAttractions() { return [
        { id: 'a', name: 'Cárl Cox' }, { id: 'b', name: 'Carl-Cox!' }, { id: 'a', name: 'Carl Cox' }, { id: 'c', name: 'Carl Cox Tribute' },
    ]; } } });
    const esito = await controllo('Carl Cox'); assert.equal(esito.stato, 'trovato'); assert.equal(esito.ambiguo, true);
    assert.deepEqual(esito.attractions.map(a => a.id), ['a', 'b']); assert.equal(esito.controllatoAt, new Date(0).toISOString());
});
test('Ticketmaster: non trovato per soli nomi simili; guasto/chiave assente non verificato', async () => {
    const c = creaControllo({ client: { async cercaAttractions() { return [{ id: 'a', name: 'Carl Cox tribute' }]; } } });
    assert.equal((await c('Carl Cox')).stato, 'non_trovato');
    assert.equal((await creaControllo({ env: { TICKETMASTER_API_KEY: '' } })('Carl Cox')).stato, 'non_verificato');
    assert.equal((await creaControllo({ client: { async cercaAttractions() { throw new Error('secret'); } } })('Carl Cox')).stato, 'non_verificato');
});
test('Ticketmaster: attraction keyword/paginazione, risposta vuota e pagine troncate', async () => {
    let n = 0;
    const c = creaClientTicketmaster({ chiave: 'mock-only', pausaMs: 0, tentativi: 0, fetchImpl: async u => {
        const url = new URL(u); assert.equal(url.pathname, '/discovery/v2/attractions.json'); assert.equal(url.searchParams.get('keyword'), 'Carl Cox');
        return new Response(JSON.stringify({ _embedded: { attractions: [{ id: `a${n++}`, name: 'Carl Cox' }] }, page: { totalPages: 2 } }));
    } });
    assert.equal((await c.cercaAttractions('Carl Cox')).length, 2);
    const vuoto = creaClientTicketmaster({ chiave: 'mock', pausaMs: 0, fetchImpl: async () => new Response(JSON.stringify({ page: { totalElements: 0, totalPages: 0 } })) });
    assert.deepEqual(await vuoto.cercaAttractions('Carl Cox'), []);
    const tronco = creaClientTicketmaster({ chiave: 'mock', pausaMs: 0, maxPagine: 1, fetchImpl: async () => new Response(JSON.stringify({ _embedded: { attractions: [] }, page: { totalPages: 2 } })) });
    await assert.rejects(tronco.cercaAttractions('Carl'), e => e.codice === 'PAGINAZIONE_TRONCATA');
});
const profilo = { externalId: '3951', name: 'Carl Cox', provider: 'deezer', url: 'https://www.deezer.com/artist/3951', storefront: '', fan: 200, artwork: null, genres: [], syncedAt: new Date(0).toISOString(), raw: { id: 3951 } };
function memoria(controllaTicketmaster) {
    let link = null, presenza = { stato: 'non_verificato', attractions: [], ambiguo: false, controllatoAt: null }, letture = [];
    const repository = {
        async artista() { return { id: 1, nome: 'Locale', id_ticketmaster: 'curato' }; }, async leggi() { return link; },
        async salva(_id, dati, versione) {
            if ((link?.versione ?? null) !== versione) throw new ErroreProvider('DEEZER_CONFLITTO', 409);
            const { raw, ...pubblico } = dati; link = { ...pubblico, versione: (link?.versione ?? 0) + 1 }; return link;
        }, async leggiPresenza() { return presenza; }, async salvaPresenza(_id, _link, e) { presenza = e; return e; },
    };
    const client = { async cerca() { return [profilo]; }, async dettaglio(...args) { letture.push(args); return profilo; } };
    return { service: creaService({ provider: 'deezer', repository, client, controllaTicketmaster }), repository, letture };
}
test('Collegamento: Ticketmaster fallisce ma profilo confermato, raw escluso e sync ID invariato', async () => {
    const { service, letture } = memoria(async () => { throw new Error('remote secret'); });
    const link = await service.collega(1, { external_id: '3951', versione_attesa: null });
    assert.equal(link.versione, 1); assert.equal(link.ticketmaster.stato, 'non_verificato'); assert(!Object.hasOwn(link, 'raw'));
    assert.equal((await service.leggi(1)).artista.id_ticketmaster, 'curato');
    const sync = await service.sincronizza(1, { versione_attesa: 1 }); assert.equal(sync.versione, 2); assert.deepEqual(letture.at(-1), ['3951', '']);
});
test('Collegamento e ricontrollo: esito persistito e versione obbligatoria', async () => {
    let n = 0; const { service } = memoria(async () => ({ stato: ++n === 1 ? 'non_trovato' : 'trovato', attractions: n === 1 ? [] : [{ id: 'a', name: 'Carl Cox' }], ambiguo: false, controllatoAt: new Date(0).toISOString() }));
    assert.equal((await service.collega(1, { external_id: '3951', versione_attesa: null })).ticketmaster.stato, 'non_trovato');
    const e = await service.ricontrolla(1, { versione_attesa: 1 }); assert.equal(e.ticketmaster.stato, 'trovato'); assert.equal(e.versione, 1);
    assert.equal((await service.leggi(1)).collegamento.ticketmaster.stato, 'trovato');
    await assert.rejects(service.ricontrolla(1, { versione_attesa: 2 }), e => e.codice === 'DEEZER_CONFLITTO');
    await assert.rejects(service.collega(1, {}), e => e.codice === 'DEEZER_PARAMETRI');
});
test('Collegamento: fallimento sola persistenza informativa non annulla conferma', async () => {
    const { service, repository } = memoria(async () => ({ stato: 'non_trovato', attractions: [], ambiguo: false, controllatoAt: new Date(0).toISOString() }));
    repository.salvaPresenza = async () => { throw new Error('DB'); };
    assert.equal((await service.collega(1, { external_id: '3951', versione_attesa: null })).ticketmaster.stato, 'non_verificato');
    assert.equal((await repository.leggi()).externalId, '3951');
});
test('Persistenza: retry deadlock limitato, stessa versione e nessuna chiamata esterna ripetuta', async () => {
    let tentativi = 0, rilasci = 0, rollback = 0;
    const pool = { async getConnection() { return {
        async beginTransaction() {}, async commit() {}, async rollback() { rollback++; }, release() { rilasci++; },
        async query(sql) {
            if (sql.startsWith('SELECT id FROM artista')) return [[{ id: 1 }]];
            if (sql.startsWith('SELECT id, external_id')) return [[]];
            if (sql.startsWith('INSERT')) { tentativi++; if (tentativi < 3) throw Object.assign(new Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }); return [{}]; }
            throw new Error('Query inattesa');
        },
    }; } };
    const r = await creaBase(pool, 'deezer').salva(1, profilo, null);
    assert.equal(r.versione, 1); assert.equal(tentativi, 3); assert.equal(rollback, 2); assert.equal(rilasci, 3);
});
