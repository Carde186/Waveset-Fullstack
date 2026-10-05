import { describe, expect, test } from 'vitest';
import {
    cercaCatalogo,
    elencaArtisti,
    elencaArtistiSeguiti,
    elencaGeneri,
    idDaPercorso,
    leggiAlbum,
    leggiArtista,
    leggiBrano,
    leggiLinkSpotify,
} from './catalogo';
import { ErroreApi, impostaCsrf } from './client';
import { json, simulaBackend } from '../test/backend';
import { ALBUM, ARTISTA, ARTISTI, BRANO, GENERI } from '../test/catalogo';

test('artisti seguiti: identità da cookie same-origin, immagini normalizzate e risposta inattesa rifiutata', async () => {
    const foto = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    const backend = simulaBackend({ 'GET /api/artisti/seguiti': json(200, [
        { id: 1, nome: 'Carl Cox', immagine_url: foto }, { id: 2, nome: 'Alesso', immagine_url: null },
    ]) });
    expect(await elencaArtistiSeguiti()).toEqual([
        { id: 1, nome: 'Carl Cox', immagineUrl: foto }, { id: 2, nome: 'Alesso', immagineUrl: null },
    ]);
    expect(backend.chiamate[0]?.init.credentials).toBe('same-origin');
    expect(backend.chiamate[0]?.percorso).toBe('/api/artisti/seguiti');
    expect(backend.chiamate[0]?.intestazioni).toEqual({ Accept: 'application/json' });
    simulaBackend({ 'GET /api/artisti/seguiti': json(200, { artisti: [] }) });
    await expect(elencaArtistiSeguiti()).rejects.toBeInstanceOf(ErroreApi);
});

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
        'GET /api/album/11/link-spotify': json(200, {
            link_store: 'https://open.spotify.com/album/esempio',
        }),
        'GET /api/album/21/link-spotify': json(404, { messaggio: 'Assente' }),
    });
    expect(await leggiLinkSpotify(11)).toContain('/album/esempio');
    expect(await leggiLinkSpotify(21)).toBeNull();
    simulaBackend({ 'GET /api/album/21/link-spotify': json(500, {}) });
    await expect(leggiLinkSpotify(21)).rejects.toMatchObject({ stato: 500 });
    simulaBackend({
        'GET /api/album/11/link-spotify': json(200, { link_store: 'https://example.org/falso' }),
    });
    await expect(leggiLinkSpotify(11)).rejects.toMatchObject({ stato: 200 });
});


test('biografia IT/EN e fan Deezer: campi pubblici, zero valido, assenza retrocompatibile', async () => {
    const biografia = { it: 'Biografia verificata.', en: 'Verified biography.', fonteUrl: 'https://example.org/artista' };
    simulaBackend({ 'GET /api/artisti/1': json(200, { ...ARTISTA, bio: null, biografia,
        popolarita_deezer: { fan: 0, url: 'https://www.deezer.com/artist/3951', aggiornato_at: '2026-10-05T10:00:00Z' } }) });
    expect(await leggiArtista(1)).toMatchObject({ biografia, popolaritaDeezer: { fan: 0, url: 'https://www.deezer.com/artist/3951' } });
    simulaBackend({ 'GET /api/artisti/1': json(200, ARTISTA) });
    expect(await leggiArtista(1)).toMatchObject({ biografia: null, popolaritaDeezer: null });
});
test.each([-1, 1.5, '1200'])('fan Deezer invalidi %j rifiutati senza inventare ascolti', async fan => {
    simulaBackend({ 'GET /api/artisti/1': json(200, { ...ARTISTA, popolarita_deezer: { fan, url: null } }) });
    await expect(leggiArtista(1)).rejects.toMatchObject({ stato: 200 });
});
