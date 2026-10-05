// Route HTTP, autenticazione e CSRF reali; pool sintetico, nessun DB o .env.
const assert = require('node:assert/strict');
const { before, beforeEach, after, test } = require('node:test');
const { hashToken } = require('../src/autenticazione/token');
const { generaCsrf } = require('../src/autenticazione/csrf');
const device = '12345678-1234-4234-8234-123456789abc';
const token = 'a'.repeat(64);
let server, origine, follow, query, ruolo, utente, guasto, profiloApple, tabellaAppleAssente, immagineCollegata, immagineLocale, copertina;
const db = { async query(sql, valori = []) {
    query.push({ sql, valori });
    if (sql.includes('FROM sessioni')) return [[{ id: 10, utente_id: utente, hash_token: hashToken(token), valida: 1, ruolo }]];
    if (guasto && !sql.includes('FROM sessioni')) throw new Error('SQL con credenziali interne');
    if (sql.includes('SELECT 1 FROM artista')) return [Number(valori[0]) <= 2 ? [{}] : []];
    if (sql.startsWith('INSERT IGNORE')) { follow.add(`${valori[0]}:${valori[1]}`); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('DELETE FROM utente_artista')) { follow.delete(`${valori[0]}:${valori[1]}`); return [{ affectedRows: 1 }]; }
    if (sql.includes('SELECT 1 FROM utente_artista')) return [follow.has(`${valori[0]}:${valori[1]}`) ? [{}] : []];
    if (sql.includes('FROM artista a') && sql.includes('INNER JOIN utente_artista ua')) {
        return [[1, 2].filter(id => follow.has(`${valori[0]}:${id}`))
            .map(id => ({ id, nome: `Artista ${id}`, immagine_url: immagineLocale }))];
    }
    if (sql.includes('FROM artista a') && sql.includes('GROUP BY')) return [[{ id: 1, nome: 'Artista', immagine_url: immagineLocale }]];
    if (sql.startsWith('SELECT artista_id, immagine_url FROM artista_provider_link')) {
        if (tabellaAppleAssente) throw Object.assign(new Error('Tabella mancante'), { code: 'ER_NO_SUCH_TABLE' });
        return [immagineCollegata ? [{ artista_id: 1, immagine_url: immagineCollegata }] : []];
    }
    if (sql.includes('FROM artista') && sql.includes('nome LIKE')) return [[{ id: 1, nome: 'Artista', immagine_url: immagineLocale }]];
    if (sql.includes('FROM artista WHERE')) return [[{ id: Number(valori[0]), nome: 'Artista', bio: null, immagine_url: immagineLocale, immagine_autore: immagineLocale ? 'Autore locale' : null }]];
    if (sql.includes('FROM artista_provider_link')) {
        if (tabellaAppleAssente) throw Object.assign(new Error('Tabella mancante'), { code: 'ER_NO_SUCH_TABLE' });
        return [profiloApple ? [{ dati_normalizzati_json: profiloApple, versione: 7 }] : []];
    }
    if (sql.includes('FROM evento e') && sql.includes('WHERE e.id = ?')) return [[{ id: Number(valori[0]), titolo: 'Principale', data_evento: '2027-01-01', latitudine: '45', longitudine: '9', immagine_evento: copertina }]];
    if (sql.includes('FROM evento e') && sql.includes('CURDATE()')) {
        const eventi = [{ id: 1, titolo: 'Principale', data_evento: '2027-01-01', latitudine: '45', longitudine: '9' }, { id: 2, titolo: 'Con ospite', data_evento: '2027-01-02', latitudine: null, longitudine: null }];
        const conFollow = sql.includes('INNER JOIN utente_artista ua');
        const selezionati = eventi.filter(e => {
            const artisti = e.id === 1 ? [1] : [1, 2];
            return (!conFollow || artisti.some(id => follow.has(`${valori[0]}:${id}`))) &&
                (!sql.includes('genere_ag.genere_id=?') || artisti.includes(valori[conFollow ? 1 : 0]));
        });
        return [selezionati.map(e => ({ ...e, immagine_evento: copertina }))];
    }
    if (sql.includes('SELECT ea.evento_id')) return [[...valori[0].flatMap(id => (id === 1 ? [1] : [1, 2]).map(a => ({ evento_id: id, id: a, nome: `Artista ${a}`, immagine_url: immagineLocale })))]];
    if (sql.includes('FROM genere') || sql.includes('FROM brano') || sql.includes('FROM album') || sql.includes('INNER JOIN evento_artista')) return [[]];
    throw new Error('Query non prevista');
} };
const dbPath = require.resolve('../src/config/database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const creaApp = require('../src/app');
const limite = { prenota: () => ({ consentito: true }) };
before(async () => {
    const app = creaApp({ configurazioneWeb: { abilitata: true, origini: new Set(['http://localhost:5173']) }, limitatoreAccount: limite, limitatoreRegistrazione: limite });
    server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', e => e ? reject(e) : resolve(s)); });
    origine = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { follow = new Set(); query = []; ruolo = 'USER'; utente = 1; guasto = false; profiloApple = null; tabellaAppleAssente = false; immagineCollegata = null; immagineLocale = null; copertina = null; });
after(async () => { if (server) await new Promise(r => server.close(r)); });
async function chiama(percorso, method = 'GET', headers = {}, body) {
    const r = await fetch(origine + '/api' + percorso, { method, headers: {
        Cookie: `waveset_sid=${device}.${token}`, Origin: 'http://localhost:5173',
        'X-CSRF-Token': generaCsrf(token), 'Content-Type': 'application/json', ...headers,
    }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, dati: await r.json().catch(() => null), headers: r.headers };
}
test('follow duplicato e unfollow inesistente sono idempotenti, dettaglio aggiornato', async () => {
    for (let i = 0; i < 2; i++) assert.equal((await chiama('/artisti/1/segui', 'PUT')).status, 204);
    assert.deepEqual([...follow], ['1:1']);
    const dettaglio = await chiama('/artisti/1');
    assert.equal(dettaglio.dati.seguito, true); assert.equal(dettaglio.headers.get('cache-control'), 'no-store');
    for (let i = 0; i < 2; i++) assert.equal((await chiama('/artisti/1/segui', 'DELETE')).status, 204);
    assert.equal(follow.size, 0); assert.equal((await chiama('/artisti/1')).dati.seguito, false);
    assert.equal((await chiama('/artisti/99999/segui', 'DELETE')).status, 204);
});
test('dettaglio artista: profilo Apple pubblico retrocompatibile, niente raw/versione/secret', async () => {
    profiloApple = { externalId: '123', name: 'Apple', url: 'https://music.apple.com/it/artist/test/123', artwork: null,
        genres: [], storefront: 'it', syncedAt: '2026-10-03T10:00:00Z', raw: { privato: 'NON_ESPOSTO' } };
    const r = await chiama('/artisti/1'); assert.equal(r.status, 200); assert.equal(r.dati.nome, 'Artista');
    assert.equal(r.dati.apple_music.externalId, '123'); assert.equal(Object.hasOwn(r.dati.apple_music, 'versione'), false);
    assert(!JSON.stringify(r.dati).includes('NON_ESPOSTO'));
    tabellaAppleAssente = true;
    const vecchio = await chiama('/artisti/1'); assert.equal(vecchio.status, 200); assert.equal(vecchio.dati.apple_music, null);
});
test('artista inesistente: follow 404, nessun inserimento', async () => {
    assert.equal((await chiama('/artisti/99999/segui', 'PUT')).status, 404);
    assert.equal(follow.size, 0);
});
test('isolamento: identità solo dalla sessione, unfollow non modifica altri utenti', async () => {
    await chiama('/artisti/1/segui', 'PUT', {}, { utente_id: 2, ruolo: 'ADMIN' });
    utente = 2;
    assert.equal((await chiama('/artisti/1')).dati.seguito, false);
    await chiama('/artisti/1/segui', 'DELETE');
    assert.deepEqual([...follow], ['1:1']);
});
test('ospiti, ADMIN, CSRF e origine errata: mutazioni vietate', async () => {
    for (const method of ['PUT', 'DELETE']) {
        assert.equal((await chiama('/artisti/1/segui', method, { Cookie: '' })).status, 401);
        assert.equal((await chiama('/artisti/1/segui', method, { 'X-CSRF-Token': '' })).status, 403);
        assert.equal((await chiama('/artisti/1/segui', method, { Origin: 'https://estraneo.test' })).status, 403);
        ruolo = 'ADMIN'; assert.equal((await chiama('/artisti/1/segui', method)).status, 403); ruolo = 'USER';
    }
    assert(!query.some(q => /INSERT|DELETE FROM utente_artista/.test(q.sql)));
});
test('trasporto bearer esistente conservato', async () => {
    const headers = { Cookie: '', Authorization: `Bearer ${token}`, 'X-Device-Id': device, Origin: '', 'X-CSRF-Token': '' };
    assert.equal((await chiama('/artisti/1/segui', 'PUT', headers)).status, 204);
    assert.equal((await chiama('/artisti/1/segui', 'DELETE', headers)).status, 204);
});
test('ID malformed, zero, negativo, decimale e fuori INT: 400 senza scritture', async () => {
    for (const id of ['zero', '0', '-1', '1.5', '01', '2147483648', '9007199254740992']) {
        for (const method of ['PUT', 'DELETE']) assert.equal((await chiama(`/artisti/${id}/segui`, method)).status, 400);
    }
    assert.equal(follow.size, 0);
});
test('errore DB follow/unfollow: 500 generico, log senza dettagli SQL', async t => {
    guasto = true;
    const log = t.mock.method(console, 'error', () => {});
    for (const method of ['PUT', 'DELETE']) {
        const r = await chiama('/artisti/1/segui', method);
        assert.equal(r.status, 500); assert.deepEqual(r.dati, { messaggio: 'Errore interno del server' });
    }
    assert(!log.mock.calls.some(c => c.arguments.map(String).join(' ').includes('SQL con credenziali')));
});
test('filtro SQL seguiti: nessun follow, artista secondario, nessun duplicato e isolamento', async () => {
    assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati, []);
    await chiama('/artisti/2/segui', 'PUT');
    assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati.map(e => e.id), [2]);
    await chiama('/artisti/1/segui', 'PUT');
    assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati.map(e => e.id), [1, 2]);
    utente = 2; assert.deepEqual((await chiama('/eventi?filtro=seguiti')).dati, []);
    assert.equal((await chiama('/eventi?filtro=seguiti', 'GET', { Cookie: '' })).status, 401);
    assert.equal((await chiama('/eventi?filtro=tutti', 'GET', { Cookie: '' })).dati.length, 2);
});

test('elenco artisti seguiti: vuoto, immagini provider/locale, unfollow e nessuna cache condivisa', async () => {
    assert.deepEqual((await chiama('/artisti/seguiti')).dati, []);
    immagineLocale = 'https://locale.waveset.test/foto.jpg';
    immagineCollegata = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    for (const id of [1, 2]) await chiama(`/artisti/${id}/segui`, 'PUT');
    const r = await chiama('/artisti/seguiti');
    assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(r.dati.map(a => a.id), [1, 2]);
    assert.equal(r.dati[0].immagine_url, immagineCollegata);
    assert.equal(r.dati[1].immagine_url, immagineLocale);
    immagineCollegata = null;
    assert.equal((await chiama('/artisti/seguiti')).dati[0].immagine_url, immagineLocale);
    for (const id of [1, 2]) await chiama(`/artisti/${id}/segui`, 'DELETE');
    assert.deepEqual((await chiama('/artisti/seguiti')).dati, []);
});

test('elenco seguiti isolato per sessione, ospite 401 e ADMIN 403', async () => {
    await chiama('/artisti/1/segui', 'PUT');
    utente = 2;
    assert.deepEqual((await chiama('/artisti/seguiti?utente_id=1')).dati, []);
    assert.equal((await chiama('/artisti/seguiti', 'GET', { Cookie: '' })).status, 401);
    ruolo = 'ADMIN'; assert.equal((await chiama('/artisti/seguiti')).status, 403);
    const lettura = query.find(q => q.sql.includes('FROM artista a') && q.sql.includes('INNER JOIN utente_artista ua'));
    assert.deepEqual(lettura.valori, [2]);
    assert(lettura.sql.includes('ORDER BY a.nome'));
    assert(lettura.sql.includes('Nova Circuit')); // stessa esclusione demo del catalogo pubblico
});

test('elenco seguiti: errore DB controllato, dettagli interni assenti', async t => {
    guasto = true;
    const log = t.mock.method(console, 'error', () => {});
    const r = await chiama('/artisti/seguiti');
    assert.equal(r.status, 500); assert.deepEqual(r.dati, { messaggio: 'Errore interno del server' });
    assert(!log.mock.calls.some(c => c.arguments.map(String).join(' ').includes('SQL con credenziali')));
});

test('seguiti e genere combinati: intersezione su qualunque artista lineup e parametri separati', async () => {
    assert.deepEqual((await chiama('/eventi?filtro=seguiti&genere_id=2')).dati, []);
    await chiama('/artisti/1/segui', 'PUT');
    assert.deepEqual((await chiama('/eventi?filtro=seguiti&genere_id=2')).dati.map(e => e.id), [2]);
    assert.deepEqual((await chiama('/eventi?filtro=seguiti&genere_id=1')).dati.map(e => e.id), [1, 2]);
    const lettura = query.find(q => q.sql.includes('CURDATE()') && q.sql.includes('genere_ag.genere_id=?'));
    assert.deepEqual(lettura.valori, [1, 2]);
    assert.equal((await chiama('/eventi?filtro=seguiti&genere_id=2', 'GET', { Cookie: '' })).status, 401);
});

test('API pubbliche: immagine provider in artista/lista/lineup, fallback locale e nessun credito locale sulla foto provider', async () => {
    immagineLocale = 'https://locale.waveset.test/foto.jpg';
    immagineCollegata = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    const lista = await chiama('/artisti'); assert.equal(lista.status, 200); assert.equal(lista.dati[0].immagine_url, immagineCollegata);
    assert.equal((await chiama('/ricerca?q=Artista')).dati.artisti[0].immagine_url, immagineCollegata);
    const dettaglioEvento = await chiama('/eventi/1'); assert.equal(dettaglioEvento.status, 200); assert.equal(dettaglioEvento.dati.lineup[0].immagine_url, immagineCollegata);
    const artista = await chiama('/artisti/1'); assert.equal(artista.dati.immagine_url, immagineCollegata);
    assert.equal(artista.dati.immagine_provider, 'deezer'); assert.equal(artista.dati.credito_immagine, null);
    const eventi = await chiama('/eventi?filtro=tutti'); assert.equal(eventi.dati[0].lineup[0].immagine_url, immagineCollegata);
    assert.deepEqual(eventi.dati[1].lineup.map(a => a.id), [1, 2]);
    assert.equal(eventi.dati[1].lineup[1].immagine_url, immagineLocale);
    immagineCollegata = null;
    assert.equal((await chiama('/artisti/1')).dati.immagine_url, immagineLocale);
    assert.equal((await chiama('/artisti/1')).dati.credito_immagine.autore, 'Autore locale');
    assert.equal((await chiama('/eventi?filtro=tutti')).dati[0].lineup[0].immagine_url, immagineLocale);
    assert.equal((await chiama('/eventi/1')).dati.lineup[0].immagine_url, immagineLocale);
    assert.equal((await chiama('/ricerca?q=Artista')).dati.artisti[0].immagine_url, immagineLocale);
    immagineLocale = null;
    assert.equal((await chiama('/artisti')).dati[0].immagine_url, null);
});

test('API pubbliche eventi: copertina Ticketmaster coerente in lista/dettaglio; assenza senza fallback artista', async () => {
    immagineCollegata = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    copertina = { url: 'https://s1.ticketm.net/dam/a/evento.jpg', width: 1024, height: 576, ratio: '16_9', fallback: false, source: 'ticketmaster' };
    for (const percorso of ['/eventi?filtro=tutti', '/eventi/1']) {
        const r = await chiama(percorso, 'GET', { Cookie: '' }); assert.equal(r.status, 200);
        const e = Array.isArray(r.dati) ? r.dati[0] : r.dati;
        assert.equal(e.immagine_url, copertina.url); assert.deepEqual(e.immagine, copertina);
        assert.equal(e.lineup[0].immagine_url, immagineCollegata);
    }
    copertina = null;
    const e = (await chiama('/eventi/1')).dati;
    assert.equal(e.immagine_url, null); assert.equal(e.immagine, null); assert.equal(e.lineup[0].immagine_url, immagineCollegata);
});
