import { describe, expect, test, vi } from 'vitest';
import { ErroreApi, impostaCsrf, leggiCsrf, richiesta } from './client';
import { json, senzaCorpo, simulaBackend } from '../test/backend';

describe('richiesta: parametri della chiamata', () => {
    test('GET su /api della stessa origine, con credenziali same-origin e senza X-CSRF-Token', async () => {
        impostaCsrf('segreto-csrf');
        const backend = simulaBackend({ 'GET /api/auth/io': json(200, { ok: true }) });

        await richiesta('/auth/io');

        const [chiamata] = backend.chiamate;
        expect(chiamata?.percorso).toBe('/api/auth/io');
        expect(chiamata?.init.credentials).toBe('same-origin');
        expect(chiamata?.intestazioni['X-CSRF-Token']).toBeUndefined();
        expect(chiamata?.intestazioni.Accept).toBe('application/json');
    });

    test('non imposta mai Origin né Cookie: li gestisce il browser', async () => {
        impostaCsrf('segreto-csrf');
        const backend = simulaBackend({ 'POST /api/x': senzaCorpo(204) });

        await richiesta('/x', { metodo: 'POST', corpo: { a: 1 } });

        const nomi = Object.keys(backend.chiamate[0]?.intestazioni ?? {}).map((n) =>
            n.toLowerCase(),
        );
        expect(nomi).not.toContain('origin');
        expect(nomi).not.toContain('cookie');
        expect(nomi).not.toContain('referer');
    });

    test('POST porta X-CSRF-Token dalla memoria e il corpo JSON', async () => {
        impostaCsrf('csrf-in-memoria');
        const backend = simulaBackend({ 'POST /api/x': senzaCorpo(204) });

        await richiesta('/x', { metodo: 'POST', corpo: { a: 1 } });

        const chiamata = backend.chiamate[0];
        expect(chiamata?.intestazioni['X-CSRF-Token']).toBe('csrf-in-memoria');
        expect(chiamata?.intestazioni['Content-Type']).toBe('application/json');
        expect(chiamata?.corpo).toEqual({ a: 1 });
    });

    test('POST con conCsrf: false non porta il token', async () => {
        impostaCsrf('csrf-in-memoria');
        const backend = simulaBackend({ 'POST /api/x': senzaCorpo(204) });

        await richiesta('/x', { metodo: 'POST', conCsrf: false });

        expect(backend.chiamate[0]?.intestazioni['X-CSRF-Token']).toBeUndefined();
    });

    test('senza token in memoria nessuna intestazione X-CSRF-Token', async () => {
        const backend = simulaBackend({ 'POST /api/x': senzaCorpo(204) });

        await richiesta('/x', { metodo: 'POST' });

        expect(backend.chiamate[0]?.intestazioni['X-CSRF-Token']).toBeUndefined();
    });
});

describe('il token CSRF resta solo in memoria', () => {
    test('non finisce in localStorage, sessionStorage né nei cookie leggibili', async () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        simulaBackend({ 'POST /api/x': senzaCorpo(204) });

        impostaCsrf('csrf-in-memoria');
        await richiesta('/x', { metodo: 'POST' });

        expect(leggiCsrf()).toBe('csrf-in-memoria');
        expect(setItem).not.toHaveBeenCalled();
        expect(localStorage).toHaveLength(0);
        expect(sessionStorage).toHaveLength(0);
        expect(document.cookie).toBe('');
    });

    test('impostaCsrf(null) lo dimentica', () => {
        impostaCsrf('x');
        impostaCsrf(null);

        expect(leggiCsrf()).toBeNull();
    });
});

describe('richiesta: risposte', () => {
    test('204 -> undefined', async () => {
        simulaBackend({ 'POST /api/x': senzaCorpo(204) });

        await expect(richiesta('/x', { metodo: 'POST' })).resolves.toBeUndefined();
    });

    test('200 -> il corpo JSON', async () => {
        simulaBackend({ 'GET /api/x': json(200, { a: 1 }) });

        await expect(richiesta('/x')).resolves.toEqual({ a: 1 });
    });

    test('errore con messaggio e campi del backend', async () => {
        simulaBackend({
            'POST /api/x': json(400, {
                messaggio: 'Dati non validi',
                campi: { email: 'formato non valido', password: 5 },
            }),
        });

        const errore = await richiesta('/x', { metodo: 'POST' }).catch((e: unknown) => e);

        expect(errore).toBeInstanceOf(ErroreApi);
        expect(errore).toMatchObject({
            stato: 400,
            messaggioServer: 'Dati non validi',
            campi: { email: 'formato non valido' }, // solo i campi testuali
        });
    });

    test('429 con Retry-After', async () => {
        simulaBackend({
            'POST /api/x': json(429, { messaggio: 'Troppe richieste' }, { 'Retry-After': '42' }),
        });

        await expect(richiesta('/x', { metodo: 'POST' })).rejects.toMatchObject({
            stato: 429,
            riprovaTraSec: 42,
        });
    });

    test('Retry-After non valido -> nessun valore', async () => {
        simulaBackend({
            'POST /api/x': json(429, {}, { 'Retry-After': 'domani' }),
        });

        await expect(richiesta('/x', { metodo: 'POST' })).rejects.toMatchObject({
            riprovaTraSec: null,
        });
    });

    test('errore con corpo non JSON (per esempio quello di un proxy): stato e nessun messaggio', async () => {
        simulaBackend({
            'GET /api/x': () =>
                new Response('Error occurred while trying to proxy', { status: 500 }),
        });

        await expect(richiesta('/x')).rejects.toMatchObject({
            stato: 500,
            messaggioServer: null,
            campi: null,
        });
    });

    test('nessuna risposta (rete): ErroreApi con stato 0', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

        const errore = await richiesta('/x').catch((e: unknown) => e);

        expect(errore).toBeInstanceOf(ErroreApi);
        expect((errore as ErroreApi).stato).toBe(0);
        expect((errore as ErroreApi).eRete).toBe(true);
    });
});
