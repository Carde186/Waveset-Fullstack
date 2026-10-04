import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { leggiCsrf } from '../api/client';
import {
    ALICE,
    CSRF,
    differita,
    json,
    renderizzaApp,
    senzaCorpo,
    sessioneDi,
    simulaBackend,
} from '../test/backend';

async function apriArea(rotte: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()), ...rotte });
    const utente = userEvent.setup();

    renderizzaApp('/area');
    await screen.findByRole('heading', { level: 1, name: 'Ciao, Alice.' });

    return { backend, utente };
}

describe('area autenticata essenziale', () => {
    test('mostra nome, email e ruolo, e solo azioni reali (uscita), senza segreti', async () => {
        await apriArea();

        expect(screen.getByText(ALICE.email)).toBeInTheDocument();
        expect(screen.getByText('Ruolo: USER')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Esci ↗/ })).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Esci da tutti i dispositivi' }),
        ).toBeInTheDocument();

        // Eventi e catalogo sono sezioni reali; Playlist non esiste ancora.
        expect(screen.getByRole('link', { name: 'Esplora' })).toHaveAttribute('href', '/esplora');
        expect(screen.getByRole('link', { name: 'Eventi' })).toHaveAttribute('href', '/eventi');
        expect(screen.queryByRole('link', { name: 'Playlist' })).not.toBeInTheDocument();
        expect(document.body).not.toHaveTextContent(CSRF);
    });

    test('un ADMIN vede il proprio ruolo', async () => {
        simulaBackend({
            'GET /api/auth/io': json(200, sessioneDi({ ...ALICE, nome: 'Admin', ruolo: 'ADMIN' })),
        });

        renderizzaApp('/area');

        expect(await screen.findByText('Ruolo: ADMIN')).toBeInTheDocument();
        const account = screen.getByRole('navigation', { name: 'La tua area' });
        expect(within(account).getByRole('link', { name: 'Registro eventi' })).toHaveAttribute('href', '/admin/eventi');
    });
});

describe('uscita: POST /api/auth/logout', () => {
    test("con il token CSRF letto dalla risposta del browser, poi torna all'accesso e dimentica il token", async () => {
        const { backend, utente } = await apriArea({ 'POST /api/auth/logout': senzaCorpo(204) });

        expect(leggiCsrf()).toBe(CSRF);
        await utente.click(screen.getByRole('button', { name: /Esci ↗/ }));

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Accedi.' }),
        ).toBeInTheDocument();

        const [uscita] = backend.di('POST', '/api/auth/logout');
        expect(uscita?.intestazioni['X-CSRF-Token']).toBe(CSRF);
        expect(uscita?.init.credentials).toBe('same-origin');
        expect(uscita?.corpo).toBeUndefined();
        expect(leggiCsrf()).toBeNull();

        // Tornata l'anonimia, la barra propone di nuovo Accedi e Registrati.
        const navigazione = screen.getByRole('navigation', { name: 'La tua area' });
        expect(within(navigazione).getByRole('link', { name: 'Registrati' })).toBeInTheDocument();
        expect(screen.queryByText('Ciao, Alice.')).not.toBeInTheDocument();
    });

    test("401: la sessione non c'era più, si torna all'accesso con un avviso", async () => {
        const { utente } = await apriArea({
            'POST /api/auth/logout': json(401, { messaggio: 'Sessione non valida' }),
        });

        await utente.click(screen.getByRole('button', { name: /Esci ↗/ }));

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Accedi.' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('La sessione non è più valida');
        expect(leggiCsrf()).toBeNull();
    });

    test("403 (CSRF o origine rifiutati): resta nell'area con un errore chiaro, ancora autenticato", async () => {
        const { utente } = await apriArea({
            'POST /api/auth/logout': json(403, { messaggio: 'Richiesta non consentita' }),
        });

        await utente.click(screen.getByRole('button', { name: /Esci ↗/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Ricarica la pagina e riprova');
        expect(screen.getByRole('heading', { level: 1, name: 'Ciao, Alice.' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Esci ↗/ })).toBeEnabled();
        expect(leggiCsrf()).toBe(CSRF);
    });

    test('rete assente: errore e nessuna uscita simulata', async () => {
        const { utente } = await apriArea({
            'POST /api/auth/logout': () => {
                throw new TypeError('Failed to fetch');
            },
        });

        await utente.click(screen.getByRole('button', { name: /Esci ↗/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Il server non risponde.');
        expect(screen.getByRole('heading', { level: 1, name: 'Ciao, Alice.' })).toBeInTheDocument();
    });

    test("durante l'uscita i pulsanti sono disattivati e la richiesta non si ripete", async () => {
        const risposta = differita<Response>();
        const { backend, utente } = await apriArea({
            'POST /api/auth/logout': () => risposta.promessa,
        });

        await utente.click(screen.getByRole('button', { name: /Esci ↗/ }));

        const inCorso = await screen.findByRole('button', { name: 'Uscita in corso…' });
        expect(inCorso).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Esci da tutti i dispositivi' })).toBeDisabled();
        await utente.click(inCorso);
        expect(backend.di('POST', '/api/auth/logout')).toHaveLength(1);

        risposta.risolvi(senzaCorpo(204));
        expect(
            await screen.findByRole('heading', { level: 1, name: 'Accedi.' }),
        ).toBeInTheDocument();
    });
});

describe('uscita da tutti i dispositivi: POST /api/auth/logout-tutti', () => {
    test('chiede conferma; «Annulla» non chiama il backend', async () => {
        const { backend, utente } = await apriArea();

        await utente.click(screen.getByRole('button', { name: 'Esci da tutti i dispositivi' }));
        expect(screen.getByRole('button', { name: 'Sì, esci da tutti' })).toBeInTheDocument();

        await utente.click(screen.getByRole('button', { name: 'Annulla' }));

        expect(
            screen.getByRole('button', { name: 'Esci da tutti i dispositivi' }),
        ).toBeInTheDocument();
        expect(backend.di('POST', '/api/auth/logout-tutti')).toHaveLength(0);
    });

    test("confermata: POST con il token CSRF, poi torna all'accesso", async () => {
        const { backend, utente } = await apriArea({
            'POST /api/auth/logout-tutti': senzaCorpo(204),
        });

        await utente.click(screen.getByRole('button', { name: 'Esci da tutti i dispositivi' }));
        await utente.click(screen.getByRole('button', { name: 'Sì, esci da tutti' }));

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Accedi.' }),
        ).toBeInTheDocument();
        expect(backend.di('POST', '/api/auth/logout-tutti')[0]?.intestazioni['X-CSRF-Token']).toBe(
            CSRF,
        );
        expect(backend.di('POST', '/api/auth/logout')).toHaveLength(0);
        expect(leggiCsrf()).toBeNull();
    });

    test("403: errore chiaro e ancora nell'area", async () => {
        const { utente } = await apriArea({
            'POST /api/auth/logout-tutti': json(403, { messaggio: 'Richiesta non consentita' }),
        });

        await utente.click(screen.getByRole('button', { name: 'Esci da tutti i dispositivi' }));
        await utente.click(screen.getByRole('button', { name: 'Sì, esci da tutti' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Ricarica la pagina e riprova');
        expect(screen.getByRole('heading', { level: 1, name: 'Ciao, Alice.' })).toBeInTheDocument();
    });
});
