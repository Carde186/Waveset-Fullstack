const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selezionaImmagine, normalizzaImmagini, leggiImmagine } = require('../src/ticketmaster/immagini');
const { normalizza } = require('../src/ticketmaster/normalizza');
const { backfillImmagini } = require('../src/ticketmaster/backfillImmagini');
const foto = (nome, width = 1024, height = 576, fallback = false) => ({ url: `https://s1.ticketm.net/dam/a/${nome}.jpg`, width, height, fallback });

test('copertine: orizzontale, larghezza sufficiente minima, 16:9 a parità e ordine deterministico', () => {
    const images = [foto('quadrata', 2048, 2048), foto('piccola', 640, 360), foto('grande', 2048, 1152), foto('tre-due', 1024, 683), foto('scelta'), foto('z-tie')];
    for (const ordine of [images, [...images].reverse()]) assert.equal(selezionaImmagine(ordine).url, foto('scelta').url);
    assert.equal(selezionaImmagine([foto('s', 320, 180), foto('m', 640, 360)]).width, 640);
    assert.equal(selezionaImmagine([foto('tre-due', 1024, 683), foto('piccola', 640, 360)]).ratio, '3_2');
});
test('copertine: non-fallback prevale anche su fallback orizzontale; fallback unico ammesso', () => {
    assert.equal(selezionaImmagine([foto('fallback', 2048, 1152, true), foto('reale', 600, 600)]).url, foto('reale', 600, 600).url);
    assert.equal(selezionaImmagine([foto('fallback', 1024, 576, true)]).fallback, true);
});
test('copertine: array assente/vuoto/inatteso, URL invalidi, dimensioni mancanti e JSON non valido', () => {
    for (const images of [undefined, null, [], {}, [null, {}, { url: foto('x').url }, foto('zero', 0), foto('no', NaN)]]) assert.equal(selezionaImmagine(images), null);
    for (const url of ['javascript:alert(1)', '/image.jpg', 'https://s1.ticketm.net.evil.test/foto.jpg', 'https://ticketmaster.evil.test/foto.jpg', 'https://cdn-images.dzcdn.net/a.jpg', 'https://user:pass@s1.ticketm.net/a.jpg', 'https://s1.ticketm.net/a.jpg?apikey=secret']) assert.equal(selezionaImmagine([{ ...foto('x'), url }]), null);
    assert.equal(normalizzaImmagini([{ ...foto('x'), url: 'http://s1.ticketm.net/x.jpg', secret: 'non salvato', ratio: '1_1' }])[0].url, 'https://s1.ticketm.net/x.jpg');
    assert.equal(leggiImmagine('JSON inatteso'), null); assert.equal(leggiImmagine({ ...foto('x'), source: 'deezer' }), null);
});
test('normalizzazione sync conserva le immagini ufficiali senza usare attraction/lineup come copertina', () => {
    const raw = { id: 'evt-1', images: [foto('evento')], _embedded: { attractions: [{ id: 'a', name: 'Carl Cox', images: [foto('artista')] }] } };
    const fonte = normalizza(raw, [{ id: 1, nome: 'Carl Cox' }]);
    assert.equal(fonte.immagine.url, foto('evento').url); assert.equal(fonte.images.length, 1);
    assert.equal(normalizza({ ...raw, images: undefined }, []).immagine, null);
});

function ambiente(snapshot = { campi: { titolo: 'Curato ADMIN' }, lineup: [{ artista_id: 5 }], altro: 'conservato' }) {
    let corrente = structuredClone(snapshot), lock = 1, rilasciato = false;
    const chiamate = [];
    const c = { async query(sql, valori = []) {
        chiamate.push({ sql, valori });
        if (sql.includes('GET_LOCK')) return [[{ acquisito: lock }]];
        if (sql.includes('RELEASE_LOCK')) return [[{ ok: 1 }]];
        if (sql.startsWith('SELECT e.id')) return [Object.hasOwn(corrente, 'immagine') ? [] : [{ id: 269, id_esterno: 'evt-1', snapshot: structuredClone(corrente) }]];
        if (sql.startsWith('UPDATE ticketmaster_evento_fonte')) {
            corrente.images = JSON.parse(valori[0]); corrente.immagine = JSON.parse(valori[1]); return [{ affectedRows: 1 }];
        }
        throw new Error('QUERY_NON_PREVISTA');
    }, release() { rilasciato = true; } };
    return { pool: { getConnection: async () => c }, chiamate, get snapshot() { return corrente; }, get rilasciato() { return rilasciato; }, occupato() { lock = 0; } };
}
test('backfill: anteprima senza rete/scritture, applicazione limitata, idempotenza e dati ADMIN conservati', async () => {
    const a = ambiente(); let richieste = 0;
    const client = { recuperaEvento: async () => { richieste++; return { id: 'evt-1', images: [foto('live')] }; } };
    const preview = await backfillImmagini({ pool: a.pool }); assert.equal(preview.daRecuperare, 1); assert.equal(richieste, 0);
    assert(!a.chiamate.some(q => q.sql.startsWith('UPDATE')));
    const prima = structuredClone(a.snapshot);
    assert.equal((await backfillImmagini({ pool: a.pool, client, applica: true })).aggiornati, 1);
    assert.deepEqual(a.snapshot, { ...prima, images: normalizzaImmagini([foto('live')]), immagine: selezionaImmagine([foto('live')]) });
    assert.equal((await backfillImmagini({ pool: a.pool, client, applica: true })).aggiornati, 0); assert.equal(richieste, 1);
    assert(a.rilasciato); assert(!a.chiamate.some(q => /^UPDATE evento\b|DELETE|INSERT/.test(q.sql)));
});
test('backfill: snapshot con images non chiama la rete, vuoto salva null, errore/404 non riscrive dati', async () => {
    for (const images of [[], [foto('esistente')]]) {
        const a = ambiente({ images });
        const r = await backfillImmagini({ pool: a.pool, applica: true });
        assert.equal(r.aggiornati, 1); assert.equal(a.snapshot.immagine?.url ?? null, selezionaImmagine(images)?.url ?? null);
    }
    for (const recuperaEvento of [async () => { throw new Error('privato'); }, async () => null, async () => ({ id: 'altro-id' })]) {
        const a = ambiente(), prima = structuredClone(a.snapshot);
        const r = await backfillImmagini({ pool: a.pool, client: { recuperaEvento }, applica: true });
        assert.equal(r.aggiornati, 0); assert.equal(r.errori + r.nonDisponibili, 1); assert.deepEqual(a.snapshot, prima);
    }
    const occupato = ambiente(); occupato.occupato();
    assert.deepEqual(await backfillImmagini({ pool: occupato.pool, applica: true }), { esito: 'occupato' }); assert(occupato.rilasciato);
});
