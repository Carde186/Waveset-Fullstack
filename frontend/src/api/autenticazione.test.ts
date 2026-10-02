import { describe, expect, test } from 'vitest';
import { accedi, esci, esciDaTutti, recuperaSessione, registrati } from './autenticazione';
import { ErroreApi, impostaCsrf, leggiCsrf } from './client';
import { ALICE, CSRF, json, senzaCorpo, sessioneDi, simulaBackend } from '../test/backend';

describe('accedi: POST /api/auth/web/login', () => {
    test('invia email e password, non porta X-CSRF-Token e tiene il token CSRF in memoria', async () => {
        impostaCsrf('vecchio');
        const backend = simulaBackend({ 'POST /api/auth/web/login': json(200, sessioneDi()) });

        const sessione = await accedi('alice@esempio.test', 'una password lunga');

        expect(sessione).toEqual({ utente: ALICE, csrf: CSRF });
        expect(backend.chiamate[0]?.corpo).toEqual({
            email: 'alice@esempio.test',
            password: 'una password lunga',
        });
        expect(backend.chiamate[0]?.intestazioni['X-CSRF-Token']).toBeUndefined();
        expect(leggiCsrf()).toBe(CSRF);
    });

    test('una risposta con forma diversa da quella documentata è un errore e non imposta nulla', async () => {
        for (const corpo of [
            { utente: ALICE },
            { csrf: CSRF },
            { utente: { ...ALICE, ruolo: 'SUPER' }, csrf: CSRF },
            { utente: { ...ALICE, id: '7' }, csrf: CSRF },
            { utente: ALICE, csrf: '' },
            [],
            null,
        ]) {
            simulaBackend({ 'POST /api/auth/web/login': json(200, corpo) });

            await expect(accedi('a@b.it', 'x')).rejects.toBeInstanceOf(ErroreApi);
            expect(leggiCsrf()).toBeNull();
        }
    });

    test('un errore non imposta il token CSRF', async () => {
        simulaBackend({
            'POST /api/auth/web/login': json(401, { messaggio: 'Email o password errati' }),
        });

        await expect(accedi('a@b.it', 'x')).rejects.toMatchObject({ stato: 401 });
        expect(leggiCsrf()).toBeNull();
    });
});

describe('recuperaSessione: GET /api/auth/io', () => {
    test('200 { utente, csrf }: restituisce la sessione e tiene il CSRF in memoria', async () => {
        simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });

        await expect(recuperaSessione()).resolves.toEqual({ utente: ALICE, csrf: CSRF });
        expect(leggiCsrf()).toBe(CSRF);
    });

    test('401: dimentica il token CSRF di prima e rilancia', async () => {
        impostaCsrf('vecchio');
        simulaBackend({ 'GET /api/auth/io': json(401, { messaggio: 'Sessione non valida' }) });

        await expect(recuperaSessione()).rejects.toMatchObject({ stato: 401 });
        expect(leggiCsrf()).toBeNull();
    });

    test('un errore di rete non toglie il token in memoria (la sessione potrebbe esserci ancora)', async () => {
        impostaCsrf('vecchio');
        simulaBackend({
            'GET /api/auth/io': () => {
                throw new TypeError('Failed to fetch');
            },
        });

        await expect(recuperaSessione()).rejects.toMatchObject({ stato: 0 });
        expect(leggiCsrf()).toBe('vecchio');
    });

    test('una risposta 200 con la forma vecchia piatta (bearer) non è accettata per il browser', async () => {
        simulaBackend({ 'GET /api/auth/io': json(200, ALICE) });

        await expect(recuperaSessione()).rejects.toBeInstanceOf(ErroreApi);
    });
});

describe.each([
    ['esci', esci, 'POST /api/auth/logout'],
    ['esciDaTutti', esciDaTutti, 'POST /api/auth/logout-tutti'],
])('%s', (_nome, funzione, rotta) => {
    test('POST con X-CSRF-Token dalla memoria; 204 -> token dimenticato', async () => {
        impostaCsrf(CSRF);
        const backend = simulaBackend({ [rotta]: senzaCorpo(204) });

        await funzione();

        expect(backend.chiamate[0]?.intestazioni['X-CSRF-Token']).toBe(CSRF);
        expect(backend.chiamate[0]?.init.credentials).toBe('same-origin');
        expect(leggiCsrf()).toBeNull();
    });

    test("401: la sessione non c'è più, token dimenticato e errore rilanciato", async () => {
        impostaCsrf(CSRF);
        simulaBackend({ [rotta]: json(401, { messaggio: 'Sessione non valida' }) });

        await expect(funzione()).rejects.toMatchObject({ stato: 401 });
        expect(leggiCsrf()).toBeNull();
    });

    test("403: il token resta (la sessione esiste ancora) e l'errore è rilanciato", async () => {
        impostaCsrf(CSRF);
        simulaBackend({ [rotta]: json(403, { messaggio: 'Richiesta non consentita' }) });

        await expect(funzione()).rejects.toMatchObject({ stato: 403 });
        expect(leggiCsrf()).toBe(CSRF);
    });
});

describe('registrati: POST /api/auth/registrazione', () => {
    test('invia esattamente { nome, email, password }, senza CSRF, e non tocca la sessione', async () => {
        impostaCsrf('in-memoria');
        const backend = simulaBackend({
            'POST /api/auth/registrazione': json(201, { utente: ALICE }),
        });

        const risposta = await registrati({
            nome: 'Alice',
            email: 'alice@esempio.test',
            password: 'una password lunga',
        });

        expect(risposta).toEqual({ utente: ALICE });
        expect(backend.chiamate[0]?.corpo).toEqual({
            nome: 'Alice',
            email: 'alice@esempio.test',
            password: 'una password lunga',
        });
        expect(backend.chiamate[0]?.intestazioni['X-CSRF-Token']).toBeUndefined();
        expect(leggiCsrf()).toBe('in-memoria');
    });

    test('risposta 201 con forma diversa: errore', async () => {
        simulaBackend({ 'POST /api/auth/registrazione': json(201, { ok: true }) });

        await expect(
            registrati({ nome: 'A', email: 'a@b.it', password: 'x' }),
        ).rejects.toBeInstanceOf(ErroreApi);
    });

    test('400 con errori per campo', async () => {
        simulaBackend({
            'POST /api/auth/registrazione': json(400, {
                messaggio: 'Dati non validi',
                campi: { password: 'almeno 12 caratteri' },
            }),
        });

        await expect(
            registrati({ nome: 'A', email: 'a@b.it', password: 'x' }),
        ).rejects.toMatchObject({ stato: 400, campi: { password: 'almeno 12 caratteri' } });
    });
});
