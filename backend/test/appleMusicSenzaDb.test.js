const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateKeyPairSync, verify } = require('node:crypto');
const { configurazione, creaToken } = require('../src/appleMusic/token');
const { creaClient, pubblico } = require('../src/appleMusic/client');
const { creaService } = require('../src/appleMusic/service');
const { ErroreAppleMusic } = require('../src/appleMusic/errore');

const chiavi = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const env = { APPLE_MUSIC_TEAM_ID: 'TESTTEAM01', APPLE_MUSIC_KEY_ID: 'TESTKEY001',
    APPLE_MUSIC_PRIVATE_KEY: chiavi.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    APPLE_MUSIC_STOREFRONT: 'gb', APPLE_MUSIC_TOKEN_TTL: '60', APPLE_MUSIC_TIMEOUT_MS: '20' };
const raw = (id = '123', patch = {}) => ({ id, type: 'artists', attributes: {
    name: 'Artista di test', url: `https://music.apple.com/gb/artist/test/${id}`, genreNames: ['Electronic'],
    artwork: { url: 'https://is1-ssl.mzstatic.com/image/{w}x{h}bb.jpg', width: 600, height: 600 }, ...patch } });
const json = (corpo, status = 200, headers = {}) => new Response(JSON.stringify(corpo), { status, headers });
const codice = atteso => e => e instanceof ErroreAppleMusic && e.codice === atteso;

test('JWT ES256 P-256: firma verificabile, claim Apple, cache e rinnovo prima della scadenza', () => {
    let ora = 1700000000000;
    const token = creaToken(configurazione(env), () => ora);
    const prima = token.leggi(), [h, p, s] = prima.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'TESTKEY001' });
    assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iss: 'TESTTEAM01', iat: 1700000000, exp: 1700000060 });
    assert.equal(Buffer.from(s, 'base64url').length, 64);
    assert(verify('sha256', Buffer.from(`${h}.${p}`), { key: chiavi.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
    ora += 40000; assert.equal(token.leggi(), prima);
    ora += 6000; assert.notEqual(token.leggi(), prima);
    token.invalida(); assert.notEqual(token.leggi(), prima);
    ora -= 100000; assert.equal(JSON.parse(Buffer.from(token.leggi().split('.')[1], 'base64url')).iat, Math.floor(ora / 1000));
});
test('config obbligatoria, limiti TTL/timeout, PEM escaped e curva: nessun segreto negli errori', () => {
    for (const campo of ['APPLE_MUSIC_TEAM_ID', 'APPLE_MUSIC_KEY_ID', 'APPLE_MUSIC_PRIVATE_KEY', 'APPLE_MUSIC_STOREFRONT']) {
        assert.throws(() => configurazione({ ...env, [campo]: '' }), codice('APPLE_CONFIGURAZIONE'));
    }
    for (const patch of [{ APPLE_MUSIC_TOKEN_TTL: '15777001' }, { APPLE_MUSIC_TOKEN_TTL: '59' },
        { APPLE_MUSIC_TIMEOUT_MS: '60001' }, { APPLE_MUSIC_TIMEOUT_MS: 'NaN' }, { APPLE_MUSIC_STOREFRONT: '../../' },
        { APPLE_MUSIC_PRIVATE_KEY: 'SEGRETO_NON_STAMPABILE' }]) {
        assert.throws(() => configurazione({ ...env, ...patch }), e => codice('APPLE_CONFIGURAZIONE')(e) && !e.message.includes('SEGRETO'));
    }
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.throws(() => configurazione({ ...env, APPLE_MUSIC_PRIVATE_KEY: rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), codice('APPLE_CONFIGURAZIONE'));
    assert.equal(configurazione({ ...env, APPLE_MUSIC_PRIVATE_KEY: env.APPLE_MUSIC_PRIVATE_KEY.replaceAll('\n', '\\n') }).storefront, 'gb');
});
test('ricerca artists soltanto, storefront configurato, dettaglio e normalizzazione pubblica senza raw/token', async () => {
    const chiamate = [];
    const client = creaClient({ env, fetchImpl: async (url, opzioni) => {
        chiamate.push({ url, opzioni }); return json(url.includes('/search?') ? { results: { artists: { data: [raw()] } } } : { data: [raw()] });
    } });
    const [profilo] = await client.cerca(' Artista & test ');
    const u = new URL(chiamate[0].url);
    assert.equal(u.pathname, '/v1/catalog/gb/search'); assert.equal(u.searchParams.get('types'), 'artists');
    assert.equal(u.searchParams.get('term'), 'Artista & test'); assert.equal(u.searchParams.get('limit'), '10');
    assert.equal(chiamate[0].opzioni.redirect, 'error'); assert.equal(chiamate[0].opzioni.method, 'GET');
    assert(chiamate[0].opzioni.headers.Authorization.startsWith('Bearer '));
    assert.equal(profilo.artwork.url, 'https://is1-ssl.mzstatic.com/image/300x300bb.jpg');
    assert.deepEqual(profilo.raw, raw()); assert.deepEqual(profilo.genres, ['Electronic']);
    assert.equal(Object.hasOwn(pubblico(profilo), 'raw'), false);
    assert.equal((await client.dettaglio('123', 'it')).storefront, 'it');
    assert.equal(chiamate[0].opzioni.headers.Authorization, chiamate[1].opzioni.headers.Authorization);
});
test('vuoto esplicito/assenza risultati e artwork assente non inventano dati', async () => {
    for (const results of [{}, { artists: { data: [] } }]) {
        assert.deepEqual(await creaClient({ env, fetchImpl: async () => json({ results }) }).cerca('Nessuno'), []);
    }
    const client = creaClient({ env, fetchImpl: async () => json({ data: [raw('123', { artwork: undefined, genreNames: [] })] }) });
    assert.equal((await client.dettaglio('123')).artwork, null);
});
test('401/403/404 e altri 4xx non ritentati, 429 e 5xx limitati a un retry', async () => {
    for (const [status, atteso, totale] of [[401, 'APPLE_AUTORIZZAZIONE', 1], [403, 'APPLE_AUTORIZZAZIONE', 1],
        [404, 'APPLE_NON_TROVATO', 1], [400, 'APPLE_RISPOSTA', 1], [429, 'APPLE_LIMITE', 2], [503, 'APPLE_TEMPORANEO', 2]]) {
        let n = 0;
        const client = creaClient({ env, attendi: async () => {}, fetchImpl: async () => { n++; return json({ errore: 'riservato' }, status); } });
        await assert.rejects(() => client.cerca('Test'), codice(atteso)); assert.equal(n, totale);
    }
    let n = 0;
    const client = creaClient({ env, attendi: async ms => assert.equal(ms, 0), fetchImpl: async () => ++n === 1 ? json({}, 429, { 'Retry-After': '0' }) : json({ data: [raw()] }) });
    assert.equal((await client.dettaglio('123')).externalId, '123'); assert.equal(n, 2);
    n = 0;
    await assert.rejects(() => creaClient({ env, fetchImpl: async () => { n++; return json({}, 429, { 'Retry-After': '120' }); } }).cerca('Test'), codice('APPLE_LIMITE'));
    assert.equal(n, 1);
});
test('rete e timeout: abort e retry GET limitato, nessun messaggio interno esposto', async () => {
    for (const timeout of [false, true]) {
        let n = 0;
        const client = creaClient({ env, attendi: async () => {}, fetchImpl: async (_url, { signal }) => {
            n++;
            if (!timeout) throw new Error('Authorization riservato');
            return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('token riservato')), { once: true }));
        } });
        await assert.rejects(() => client.dettaglio('123'), codice(timeout ? 'APPLE_TIMEOUT' : 'APPLE_RETE'));
        assert.equal(n, 2);
    }
});
test('payload incompleto, JSON inatteso, risorsa errata, URL insicuri e ID diverso non salvabili', async () => {
    for (const corpo of [[], null, { data: {} }, { errors: [] }, { data: [{ id: '123' }] }, { data: [raw('456')] },
        { data: [raw('123', { name: '' })] }, { data: [raw('123', { genreNames: null })] }, { data: [raw('123', { url: 'javascript:bad' })] },
        { data: [raw('123', { artwork: { url: 'https://evil.test/foto.jpg' } })] }]) {
        let n = 0;
        const client = creaClient({ env, fetchImpl: async () => { n++; return json(corpo); } });
        await assert.rejects(() => client.dettaglio('123'), codice('APPLE_DATI_INVALIDI')); assert.equal(n, 1);
    }
    await assert.rejects(() => creaClient({ env, fetchImpl: async () => new Response('non-json') }).cerca('Test'), codice('APPLE_DATI_INVALIDI'));
    await assert.rejects(() => creaClient({ env, fetchImpl: async () => json({ data: [] }) }).dettaglio('123'), codice('APPLE_NON_TROVATO'));
    await assert.rejects(() => creaClient({ env, fetchImpl: async () => new Response('x'.repeat(1048577)) }).dettaglio('123'), codice('APPLE_DATI_INVALIDI'));
});
test('input invalidi/config assente non chiamano Apple; 401 invalida il token successivo', async () => {
    let n = 0;
    const client = creaClient({ env, fetchImpl: async () => { n++; return json({}, 401); } });
    for (const q of ['', 'x'.repeat(201), {}, ['test']]) await assert.rejects(() => client.cerca(q), codice('APPLE_PARAMETRI'));
    for (const id of ['../123', '0', 123]) await assert.rejects(() => client.dettaglio(id), codice('APPLE_PARAMETRI'));
    await assert.rejects(() => client.dettaglio('123', '../../'), codice('APPLE_PARAMETRI'));
    await assert.rejects(() => creaClient({ env: {}, fetchImpl: async () => n++ }).cerca('Test'), codice('APPLE_CONFIGURAZIONE'));
    assert.equal(n, 0);
    const tokens = [];
    const auth = creaClient({ env, fetchImpl: async (_u, o) => { tokens.push(o.headers.Authorization); return json({}, 401); } });
    for (let i = 0; i < 2; i++) await assert.rejects(() => auth.cerca('Test'), codice('APPLE_AUTORIZZAZIONE'));
    assert.notEqual(tokens[0], tokens[1]);
});
test('ricerca scarta ID numerici, duplicati e troppi risultati; retry 5xx recupera', async () => {
    for (const data of [[{ ...raw(), id: 123 }], [raw(), raw()], Array.from({ length: 11 }, (_, i) => raw(String(100 + i)))]) {
        await assert.rejects(() => creaClient({ env, fetchImpl: async () => json({ results: { artists: { data } } }) }).cerca('Test'), codice('APPLE_DATI_INVALIDI'));
    }
    let n = 0;
    const client = creaClient({ env, attendi: async ms => assert.equal(ms, 250), fetchImpl: async () => ++n === 1 ? json({}, 502) : json({ data: [raw()] }) });
    assert.equal((await client.dettaglio('123')).externalId, '123'); assert.equal(n, 2);
});
test('timeout resta attivo durante un corpo HTTP bloccato e interrompe la lettura', async () => {
    let n = 0;
    const client = creaClient({ env, attendi: async () => {}, fetchImpl: async (_u, { signal }) => {
        n++;
        const body = new ReadableStream({ start(c) { signal.addEventListener('abort', () => c.error(new Error('aborted')), { once: true }); } });
        return new Response(body);
    } });
    await assert.rejects(() => client.dettaglio('123'), codice('APPLE_TIMEOUT')); assert.equal(n, 2);
});

test('service: conferma, sostituzione controllata, sync storefront salvato, errori senza perdere dati', async () => {
    let link = null, guasto = false; const dettagli = [];
    const repository = {
        async artista(id) { if (id !== 1) throw new ErroreAppleMusic('ARTISTA_NON_TROVATO', 404); return { id, nome: 'Locale' }; },
        async leggi() { return link; },
        async salva(_id, dati, attesa) {
            if ((link?.versione ?? null) !== attesa) throw new ErroreAppleMusic('APPLE_CONFLITTO', 409);
            link = { ...pubblico(dati), versione: (link?.versione ?? 0) + 1 }; return link;
        },
    };
    const client = { async cerca() { return [{ externalId: '123', raw: raw() }]; }, async dettaglio(id, sf) {
        dettagli.push([id, sf]); if (guasto) throw new ErroreAppleMusic('APPLE_TIMEOUT', 503);
        return { externalId: id, name: 'Apple', storefront: sf ?? 'gb', raw: raw(id) };
    } };
    const service = creaService({ repository, client });
    assert.equal((await service.leggi(1)).collegamento, null);
    assert.equal(Object.hasOwn((await service.cerca(1, 'Test')).risultati[0], 'raw'), false);
    await assert.rejects(() => service.sincronizza(1, { versione_attesa: null }), codice('APPLE_LINK_ASSENTE'));
    assert.equal((await service.collega(1, { external_id: '123', versione_attesa: null })).versione, 1);
    await assert.rejects(() => service.collega(1, { external_id: '456', versione_attesa: null }), codice('APPLE_CONFLITTO'));
    assert.equal(link.externalId, '123');
    assert.equal((await service.collega(1, { external_id: '456', versione_attesa: 1 })).versione, 2);
    guasto = true; await assert.rejects(() => service.sincronizza(1, { versione_attesa: 2 }), codice('APPLE_TIMEOUT')); assert.equal(link.versione, 2);
    guasto = false; assert.equal((await service.sincronizza(1, { versione_attesa: 2 })).versione, 3);
    assert.deepEqual(dettagli.at(-1), ['456', 'gb']);
    await assert.rejects(() => service.sincronizza(1, { versione_attesa: 1 }), codice('APPLE_CONFLITTO'));
    await assert.rejects(() => service.collega(1, { external_id: '123' }), codice('APPLE_PARAMETRI'));
    await assert.rejects(() => service.cerca(99, 'Test'), codice('ARTISTA_NON_TROVATO'));
});
