import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { leggiCsrf } from '../api/client';
import {
    ALICE,
    CSRF,
    SESSIONE_NON_VALIDA,
    differita,
    json,
    renderizzaApp,
    sessioneDi,
    simulaBackend,
} from '../test/backend';

async function apriAccesso(rotte: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), ...rotte });
    const utente = userEvent.setup();

    renderizzaApp('/accedi');
    await screen.findByRole('heading', { level: 1, name: 'Accedi.' });

    return { backend, utente };
}

async function compilaEInvia(
    utente: ReturnType<typeof userEvent.setup>,
    email: string,
    password: string,
) {
    if (email) {
        await utente.type(screen.getByLabelText('Email'), email);
    }
    if (password) {
        await utente.type(screen.getByLabelText('Password'), password);
    }
    await utente.click(screen.getByRole('button', { name: /Accedi ↗/ }));
}

describe('schermata di accesso', () => {
    test('mostra i campi, il collegamento alla registrazione e nessun avviso', async () => {
        await apriAccesso();

        expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
        expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
        expect(screen.getByLabelText('Password')).toHaveAttribute(
            'autocomplete',
            'current-password',
        );
        // Il collegamento nel modulo (la barra ha un altro «Registrati»).
        expect(
            within(screen.getByRole('main')).getByRole('link', { name: 'Registrati' }),
        ).toHaveAttribute('href', '/registrati');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test('campi vuoti: errori per campo e nessuna chiamata di accesso', async () => {
        const { backend, utente } = await apriAccesso();

        await utente.click(screen.getByRole('button', { name: /Accedi ↗/ }));

        expect(screen.getByText('Inserisci la tua email.')).toBeInTheDocument();
        expect(screen.getByText('Inserisci la password.')).toBeInTheDocument();
        expect(screen.getByLabelText('Email')).toBeInvalid();
        expect(backend.di('POST', '/api/auth/web/login')).toHaveLength(0);
    });

    test("successo: POST web/login con le credenziali, senza CSRF; va all'area con il CSRF in memoria", async () => {
        const { backend, utente } = await apriAccesso({
            'POST /api/auth/web/login': json(200, sessioneDi()),
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        await compilaEInvia(utente, '  alice@esempio.test ', 'una password lunga');

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Ciao, Alice.' }),
        ).toBeInTheDocument();

        const [login] = backend.di('POST', '/api/auth/web/login');
        expect(login?.corpo).toEqual({
            email: 'alice@esempio.test',
            password: 'una password lunga',
        });
        expect(login?.intestazioni['X-CSRF-Token']).toBeUndefined();
        expect(login?.init.credentials).toBe('same-origin');
        expect(leggiCsrf()).toBe(CSRF);
        expect(setItem).not.toHaveBeenCalled();
        expect(localStorage).toHaveLength(0);
        expect(sessionStorage).toHaveLength(0);
        expect(document.body).not.toHaveTextContent('una password lunga');
    });

    test("401: «Email o password errati.», la password si svuota e l'email resta", async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': json(401, { messaggio: 'Email o password errati' }),
        });

        await compilaEInvia(utente, ALICE.email, 'sbagliata');

        expect(await screen.findByRole('alert')).toHaveTextContent('Email o password errati.');
        expect(screen.getByLabelText('Email')).toHaveValue(ALICE.email);
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByRole('heading', { level: 1, name: 'Accedi.' })).toBeInTheDocument();
        expect(leggiCsrf()).toBeNull();
    });

    test('400: chiede di inserire email e password', async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': json(400, { messaggio: 'email e password obbligatori' }),
        });

        await compilaEInvia(utente, ALICE.email, 'x');

        expect(await screen.findByRole('alert')).toHaveTextContent('Inserisci email e password.');
    });

    test("403: spiega che l'origine della pagina non è ammessa", async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': json(403, { messaggio: 'Richiesta non consentita' }),
        });

        await compilaEInvia(utente, ALICE.email, 'x');

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "l'origine di questa pagina non è tra quelle ammesse",
        );
    });

    test('429 con Retry-After: mostra i secondi', async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': json(
                429,
                { messaggio: 'Troppe richieste' },
                { 'Retry-After': '42' },
            ),
        });

        await compilaEInvia(utente, ALICE.email, 'x');

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Troppi tentativi. Riprova tra 42 secondi.',
        );
    });

    test('429 senza Retry-After: messaggio senza secondi', async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': json(429, { messaggio: 'Troppe richieste' }),
        });

        await compilaEInvia(utente, ALICE.email, 'x');

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Troppi tentativi. Riprova tra qualche minuto.',
        );
    });

    test('503 «Sessione browser non disponibile»: dice chiaramente che la sessione web non è configurata', async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': json(503, {
                messaggio: 'Sessione browser non disponibile',
            }),
        });

        await compilaEInvia(utente, ALICE.email, 'x');

        const avviso = await screen.findByRole('alert');
        expect(avviso).toHaveTextContent('La sessione del browser non è attiva su questo server');
        expect(avviso).toHaveTextContent('FRONTEND_ORIGINS');
        expect(leggiCsrf()).toBeNull();
    });

    test('503 o 500 senza quel messaggio: backend non raggiungibile, con il codice', async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': () => new Response('proxy', { status: 500 }),
        });

        await compilaEInvia(utente, ALICE.email, 'x');

        expect(await screen.findByRole('alert')).toHaveTextContent('codice 500');
    });

    test('rete assente: «Il server non risponde.»', async () => {
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': () => {
                throw new TypeError('Failed to fetch');
            },
        });

        await compilaEInvia(utente, ALICE.email, 'x');

        expect(await screen.findByRole('alert')).toHaveTextContent('Il server non risponde.');
    });

    test("durante l'invio il pulsante è disattivato e l'invio non si ripete", async () => {
        const risposta = differita<Response>();
        const { backend, utente } = await apriAccesso({
            'POST /api/auth/web/login': () => risposta.promessa,
        });

        await compilaEInvia(utente, ALICE.email, 'una password lunga');

        const pulsante = await screen.findByRole('button', { name: 'Accesso in corso…' });
        expect(pulsante).toBeDisabled();
        expect(screen.getByLabelText('Email')).toBeDisabled();
        await utente.click(pulsante);
        expect(backend.di('POST', '/api/auth/web/login')).toHaveLength(1);

        risposta.risolvi(json(200, sessioneDi()));
        expect(
            await screen.findByRole('heading', { level: 1, name: 'Ciao, Alice.' }),
        ).toBeInTheDocument();
    });

    test('dopo un errore si può riprovare e il secondo tentativo riesce', async () => {
        let tentativo = 0;
        const { utente } = await apriAccesso({
            'POST /api/auth/web/login': () => {
                tentativo += 1;
                return tentativo === 1
                    ? json(401, { messaggio: 'Email o password errati' })
                    : json(200, sessioneDi());
            },
        });

        await compilaEInvia(utente, ALICE.email, 'sbagliata');
        expect(await screen.findByRole('alert')).toBeInTheDocument();

        await utente.type(screen.getByLabelText('Password'), 'giusta');
        await utente.click(screen.getByRole('button', { name: /Accedi ↗/ }));

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Ciao, Alice.' }),
        ).toBeInTheDocument();
    });
});
