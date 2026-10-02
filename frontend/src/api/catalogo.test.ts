import { describe, expect, test } from 'vitest';
import {
    cercaCatalogo,
    elencaArtisti,
    elencaGeneri,
    idDaPercorso,
    leggiAlbum,
    leggiArtista,
    leggiBrano,
    leggiLinkApple,
    leggiLinkSpotify,
} from './catalogo';
import { ErroreApi, impostaCsrf } from './client';
import { json, simulaBackend } from '../test/backend';
import { ALBUM, ARTISTA, ARTISTI, BRANO, GENERI } from '../test/catalogo';

test('catalogo pubblico: client esistente, GET same-origin, nessun header di autenticazione inventato', async () => {
    impostaCsrf('csrf-di-prova');
    const backend = simulaBackend({
        'GET /api/generi': json(200, GENERI),
        'GET /api/artisti?genere_id=2': json(200, ARTISTI),
    });
    expect(await elencaGeneri()).toEqual(GENERI);
    expect(await elencaArtisti(2)).toEqual([{ id: 1, nome: 'Nova Circuit', immagineUrl: null }]);
    for (const c of backend.chiamate) {
        expect(c.init.credentials).toBe('same-origin');
        expect(c.corpo).toBeUndefined();
        expect(Object.keys(c.intestazioni)).toEqual(['Accept']);
    }
});

test('ricerca: trim e codifica di caratteri speciali, senza parametro genere', async () => {
    const q = 'a & %_';
    const percorso = `/api/ricerca?${new URLSearchParams({ q })}`;
    const backend = simulaBackend({
        [`GET ${percorso}`]: json(200, { artisti: ARTISTI, brani: [BRANO] }),
    });
    const risultato = await cercaCatalogo(`  ${q}  `);
    expect(risultato.brani[0]?.dataPubblicazione).toBe('2022-06-10');
    expect(risultato.brani[0]?.album?.copertinaUrl).toBeNull();
    expect(backend.chiamate[0]?.percorso).not.toContain('genere');
});

test('ricerca: meno di 2 o oltre 100 caratteri non inviano HTTP; 2 e 100 sono ammessi', async () => {
    const cento = 'a'.repeat(100);
    const backend = simulaBackend({
        'GET /api/ricerca?q=ab': json(200, { artisti: [], brani: [] }),
        [`GET /api/ricerca?q=${cento}`]: json(200, { artisti: [], brani: [] }),
    });
    expect(await cercaCatalogo(' a ')).toEqual({ artisti: [], brani: [] });
    await expect(cercaCatalogo('a'.repeat(101))).rejects.toMatchObject({ stato: 400 });
    expect(backend.chiamate).toHaveLength(0);
    await cercaCatalogo('ab');
    await cercaCatalogo(cento);
    expect(backend.chiamate).toHaveLength(2);
});

test('artista: normalizza SQL, date, credito e FK album nullable', async () => {
    simulaBackend({
        'GET /api/artisti/1': json(200, {
            ...ARTISTA,
            brani: [{ ...ARTISTA.brani[0], album_id: null }],
            credito_immagine: {
                autore: 'Autore',
                licenza: null,
                fonte_url: 'https://example.org/foto',
                modificata: true,
            },
        }),
    });
    const artista = await leggiArtista(1);
    expect(artista.brani[0]).toMatchObject({
        id: 11,
        albumId: null,
        dataPubblicazione: '2022-06-10',
        urlSpotify: null,
    });
    expect(artista.creditoImmagine).toEqual({
        autore: 'Autore',
        licenza: null,
        fonteUrl: 'https://example.org/foto',
        modificata: true,
    });
    expect(artista.eventi[0]).toMatchObject({ dataEvento: '2027-02-13', oraEvento: null });
    expect(artista).not.toHaveProperty('credito_immagine');
});

test('album: normalizza i brani SQL; brano: conserva album nullo e featuring senza alterare titolo', async () => {
    simulaBackend({
        'GET /api/album/21': json(200, ALBUM),
        'GET /api/brani/11': json(200, {
            ...BRANO,
            album: null,
            collaboratori: 'Ospite',
            dataPubblicazione: null,
        }),
    });
    expect((await leggiAlbum(21)).brani[0]).toEqual({
        id: 11,
        titolo: 'Voltaggio',
        dataPubblicazione: '2022-06-10',
        urlSpotify: null,
    });
    expect(await leggiBrano(11)).toMatchObject({
        titolo: 'Voltaggio',
        album: null,
        collaboratori: 'Ospite',
        dataPubblicazione: null,
    });
});

describe('risposte inattese rifiutate, mai convertite in un risultato vuoto', () => {
    test.each([
        null,
        {},
        [{ id: '1', nome: 'Techno' }],
        [{ id: 0, nome: 'Techno' }],
        [{ id: 1.5, nome: 'Techno' }],
        [{ id: 1, nome: null }],
    ])('generi %j', async (corpo) => {
        simulaBackend({ 'GET /api/generi': json(200, corpo) });
        await expect(elencaGeneri()).rejects.toBeInstanceOf(ErroreApi);
    });
    test.each([
        { ...BRANO, artista: null },
        { ...BRANO, album: {} },
        { ...BRANO, collaboratori: 2 },
        { ...BRANO, dataPubblicazione: '2024-02-30' },
        { ...BRANO, urlSpotify: {} },
        { ...BRANO, id: 12 },
    ])('brano %j', async (corpo) => {
        simulaBackend({ 'GET /api/brani/11': json(200, corpo) });
        await expect(leggiBrano(11)).rejects.toMatchObject({ stato: 200 });
    });
    test.each([
        { ...ARTISTA, generi: null },
        { ...ARTISTA, seguito: 1 },
        { ...ARTISTA, credito_immagine: {} },
        { ...ARTISTA, eventi: [{}] },
        { ...ARTISTA, album: [{}] },
        { ...ARTISTA, brani: [{}] },
    ])('artista %j', async (corpo) => {
        simulaBackend({ 'GET /api/artisti/1': json(200, corpo) });
        await expect(leggiArtista(1)).rejects.toMatchObject({ stato: 200 });
    });
    test('ricerca e album richiedono liste e oggetti annidati validi', async () => {
        simulaBackend({
            'GET /api/ricerca?q=ab': json(200, { artisti: [], brani: null }),
            'GET /api/album/21': json(200, { ...ALBUM, brani: [{}] }),
        });
        await expect(cercaCatalogo('ab')).rejects.toBeInstanceOf(ErroreApi);
        await expect(leggiAlbum(21)).rejects.toBeInstanceOf(ErroreApi);
    });
});

test('nessun URL attivo non sicuro né foto Picsum nel modello UI', async () => {
    simulaBackend({
        'GET /api/brani/11': json(200, {
            ...BRANO,
            urlSpotify: 'javascript:alert(1)',
            artista: { ...BRANO.artista, immagineUrl: 'https://fastly.picsum.photos/foto' },
        }),
    });
    const brano = await leggiBrano(11);
    expect(brano.urlSpotify).toBeNull();
    expect(brano.artista.immagineUrl).toBeNull();
});

test('ID di percorso e numerici invalidi non generano richieste', async () => {
    const backend = simulaBackend({});
    for (const v of [undefined, '0', '-1', '1.2', 'abc', '1/altro', '9007199254740993'])
        expect(idDaPercorso(v)).toBeNull();
    expect(idDaPercorso('21')).toBe(21);
    await expect(leggiAlbum(0)).rejects.toMatchObject({ stato: 404 });
    expect(backend.chiamate).toHaveLength(0);
});

test('404, rete e 500 del dettaglio restano distinguibili', async () => {
    for (const stato of [404, 500]) {
        simulaBackend({ 'GET /api/artisti/1': json(stato, { messaggio: 'Errore' }) });
        await expect(leggiArtista(1)).rejects.toMatchObject({ stato });
    }
    simulaBackend({
        'GET /api/artisti/1': () => {
            throw new TypeError('rete');
        },
    });
    await expect(leggiArtista(1)).rejects.toMatchObject({ stato: 0 });
});

test('link statici: mapping 404 assente, URL specifico valido, guasto non trattato come assenza', async () => {
    simulaBackend({
        'GET /api/brani/11/link-apple': json(200, {
            link_traccia: 'https://music.apple.com/it/album/esempio/1?i=2',
        }),
        'GET /api/album/21/link-spotify': json(404, { messaggio: 'Assente' }),
    });
    expect(await leggiLinkApple(11)).toContain('?i=2');
    expect(await leggiLinkSpotify(21)).toBeNull();
    simulaBackend({ 'GET /api/album/21/link-spotify': json(500, {}) });
    await expect(leggiLinkSpotify(21)).rejects.toMatchObject({ stato: 500 });
    simulaBackend({
        'GET /api/brani/11/link-apple': json(200, { link_traccia: 'https://example.org/falso' }),
    });
    await expect(leggiLinkApple(11)).rejects.toMatchObject({ stato: 200 });
});
