import { describe, expect, test } from 'vitest';
import { ErroreApi } from './client';
import { elencaEventi, idEventoDaPercorso, leggiEvento, normalizzaEvento } from './eventi';
import { json, simulaBackend } from '../test/backend';

const EVENTO = {
    id: 3, titolo: 'Notte Elettrica', data_evento: '2027-02-13', ora_evento: '23:30:00',
    luogo: 'Arca', citta: 'Milano', latitudine: 45.47, longitudine: 9.18,
    lineup: [{ id: 1, nome: 'Nova Circuit', immagine_url: 'https://example.org/nova.jpg' }],
};

test('tutti, seguiti e dettaglio usano i percorsi reali e il cookie della stessa origine', async () => {
    const backend = simulaBackend({
        'GET /api/eventi?filtro=tutti': json(200, [EVENTO]),
        'GET /api/eventi?filtro=seguiti': json(200, []),
        'GET /api/eventi/3': json(200, EVENTO),
    });
    expect((await elencaEventi())[0]).toMatchObject({
        id: 3, dataEvento: '2027-02-13', oraEvento: '23:30:00',
        coordinate: { lat: 45.47, lng: 9.18 },
        lineup: [{ id: 1, nome: 'Nova Circuit', immagineUrl: 'https://example.org/nova.jpg' }],
    });
    expect(await elencaEventi('seguiti')).toEqual([]);
    expect((await leggiEvento(3)).titolo).toBe('Notte Elettrica');
    expect(backend.chiamate.map((c) => c.percorso)).toEqual([
        '/api/eventi?filtro=tutti', '/api/eventi?filtro=seguiti', '/api/eventi/3',
    ]);
    expect(backend.chiamate.every((c) => c.init.credentials === 'same-origin')).toBe(true);
});

test('snake_case e camelCase, coordinate DECIMAL stringa e lineup senza immagine', () => {
    const misto = { ...EVENTO, data_evento: undefined, dataEvento: '2027-02-13', ora_evento: undefined,
        oraEvento: '20:15', latitudine: '0.000000', longitudine: '-90.100000',
        lineup: [{ id: 5, nome: 'Artista', immagineUrl: null }] };
    expect(normalizzaEvento(misto)).toMatchObject({
        dataEvento: '2027-02-13', oraEvento: '20:15', coordinate: { lat: 0, lng: -90.1 },
        lineup: [{ id: 5, nome: 'Artista', immagineUrl: null }],
    });
});

test.each([
    [null, null], [91, 5], [45, -181], ['NaN', 3], [null, 3], [0, null],
])('coordinate non utilizzabili (%s, %s): l’evento resta in lista', (lat, lng) => {
    expect(normalizzaEvento({ ...EVENTO, latitudine: lat, longitudine: lng }).coordinate).toBeNull();
});

describe('risposte invalide', () => {
    test.each([
        { ...EVENTO, data_evento: '2027-02-29' },
        { ...EVENTO, data_evento: '2027-02-13T00:00:00.000Z' },
        { ...EVENTO, ora_evento: '25:00:00' },
        { ...EVENTO, lineup: null },
        { ...EVENTO, lineup: [{}] },
        { ...EVENTO, lineup: [EVENTO.lineup[0], EVENTO.lineup[0]] },
        { ...EVENTO, id: '3' },
    ])('il dettaglio rifiuta campi non validi', async (corpo) => {
        simulaBackend({ 'GET /api/eventi/3': json(200, corpo) });
        await expect(leggiEvento(3)).rejects.toMatchObject({ stato: 200 });
    });
    test('elenco non-array, ID duplicati e ID non corrispondente', async () => {
        simulaBackend({ 'GET /api/eventi?filtro=tutti': json(200, {}) });
        await expect(elencaEventi()).rejects.toBeInstanceOf(ErroreApi);
        simulaBackend({ 'GET /api/eventi?filtro=tutti': json(200, [EVENTO, EVENTO]) });
        await expect(elencaEventi()).rejects.toMatchObject({ stato: 200 });
        simulaBackend({ 'GET /api/eventi/4': json(200, EVENTO) });
        await expect(leggiEvento(4)).rejects.toMatchObject({ stato: 200 });
    });
});

test('ID e filtro invalidi non interrogano il backend', async () => {
    const backend = simulaBackend({});
    for (const input of [undefined, '0', '-1', '1.2', '01', 'abc', '9007199254740993'])
        expect(idEventoDaPercorso(input)).toBeNull();
    expect(idEventoDaPercorso('99')).toBe(99);
    await expect(leggiEvento(0)).rejects.toMatchObject({ stato: 400 });
    await expect(leggiEvento(Number.NaN)).rejects.toMatchObject({ stato: 400 });
    await expect(elencaEventi('altro' as 'tutti')).rejects.toMatchObject({ stato: 400 });
    expect(backend.chiamate).toHaveLength(0);
});

test('401, 404 e 400 del backend mantengono lo stato HTTP', async () => {
    simulaBackend({
        'GET /api/eventi?filtro=seguiti': json(401, { messaggio: 'Sessione non valida' }),
        'GET /api/eventi/99': json(404, { messaggio: 'Evento non trovato' }),
        'GET /api/eventi?filtro=tutti': json(400, { messaggio: 'filtro deve essere tutti o seguiti' }),
    });
    await expect(elencaEventi('seguiti')).rejects.toMatchObject({ stato: 401 });
    await expect(leggiEvento(99)).rejects.toMatchObject({ stato: 404 });
    await expect(elencaEventi()).rejects.toMatchObject({ stato: 400 });
});

test('copertina normalizzata separatamente dalle foto lineup; legacy e URL non valido => null', () => {
    const url = 'https://s1.ticketm.net/dam/a/evento.jpg';
    const immagine = { url, width: 1024, height: 576, ratio: '16_9', fallback: false, source: 'ticketmaster' };
    const e = normalizzaEvento({ ...EVENTO, immagine_url: url, immagine });
    expect(e.immagineUrl).toBe(url); expect(e.immagine).toEqual(immagine);
    expect(e.lineup[0]?.immagineUrl).toBe('https://example.org/nova.jpg');
    for (const immagine_url of [undefined, null, 'javascript:alert(1)', 'https://user:pass@example.org/image.jpg']) {
        const senza = normalizzaEvento({ ...EVENTO, immagine_url, immagine });
        expect(senza.immagineUrl).toBeNull(); expect(senza.immagine).toBeNull();
    }
});


test('genere: parametro pubblico per ID, ID errati non fanno richieste', async () => {
    const backend = simulaBackend({ 'GET /api/eventi?filtro=tutti&genere_id=2': json(200, []) });
    expect(await elencaEventi('tutti', 2)).toEqual([]);
    for (const n of [0, -1, 1.5, 2147483648, NaN]) await expect(elencaEventi('tutti', n)).rejects.toMatchObject({ stato: 400 });
    expect(backend.chiamate).toHaveLength(1);
});
