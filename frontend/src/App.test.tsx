import { screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { leggiCsrf } from './api/client';
import {
    ALICE,
    CSRF,
    SESSIONE_NON_VALIDA,
    differita,
    json,
    renderizzaApp,
    sessioneDi,
    simulaBackend,
} from './test/backend';

const titolo = (nome: string) => screen.findByRole('heading', { level: 1, name: nome });

describe('riconoscimento della sessione con /auth/io (avvio e ricarico)', () => {
    test("mentre controlla mostra il caricamento, poi l'accesso se non c'è una sessione (401)", async () => {
        const io = differita<Response>();
        const backend = simulaBackend({ 'GET /api/auth/io': () => io.promessa });

        renderizzaApp('/');

        expect(await screen.findByRole('status')).toHaveTextContent('Controllo la sessione…');
        io.risolvi(SESSIONE_NON_VALIDA());

        expect(await titolo('Accedi.')).toBeInTheDocument();
        expect(backend.chiamate).toHaveLength(1);
        expect(backend.chiamate[0]?.metodo).toBe('GET');
        expect(leggiCsrf()).toBeNull();
    });

    test("con una sessione valida va all'area, mostra l'utente e tiene il CSRF solo in memoria", async () => {
        const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        renderizzaApp('/');

        expect(await titolo('Ciao, Alice.')).toBeInTheDocument();
        expect(screen.getByText(ALICE.email)).toBeInTheDocument();
        expect(screen.getByText('Ruolo: USER')).toBeInTheDocument();
        expect(backend.chiamate).toHaveLength(1);
        expect(leggiCsrf()).toBe(CSRF);

        // Il token CSRF non compare nella pagina né in nessun archivio del browser.
        expect(document.body).not.toHaveTextContent(CSRF);
        expect(setItem).not.toHaveBeenCalled();
        expect(localStorage).toHaveLength(0);
        expect(sessionStorage).toHaveLength(0);
        expect(document.cookie).toBe('');
    });

    test('dopo un ricarico (nuovo rendering) la sessione si riconosce senza un nuovo login', async () => {
        const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });

        const primo = renderizzaApp('/area');
        expect(await titolo('Ciao, Alice.')).toBeInTheDocument();
        primo.unmount();

        renderizzaApp('/area');
        expect(await titolo('Ciao, Alice.')).toBeInTheDocument();

        expect(backend.chiamate.map((c) => `${c.metodo} ${c.percorso}`)).toEqual([
            'GET /api/auth/io',
            'GET /api/auth/io',
        ]);
    });

    test("senza sessione, /area porta all'accesso", async () => {
        simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });

        renderizzaApp('/area');

        expect(await titolo('Accedi.')).toBeInTheDocument();
    });

    test("con una sessione, /accedi e /registrati portano all'area", async () => {
        simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });

        renderizzaApp('/accedi');
        expect(await titolo('Ciao, Alice.')).toBeInTheDocument();
    });

    test('il backend non risponde: stato di errore con «Riprova», che ripete il controllo', async () => {
        let tentativo = 0;
        const backend = simulaBackend({
            'GET /api/auth/io': () => {
                tentativo += 1;
                if (tentativo === 1) {
                    throw new TypeError('Failed to fetch');
                }
                return SESSIONE_NON_VALIDA();
            },
        });

        renderizzaApp('/');

        const errore = await screen.findByRole('alert');
        expect(errore).toHaveTextContent('Il server non risponde.');
        expect(errore).toHaveTextContent('Controlla che il backend sia avviato');

        const { default: userEvent } = await import('@testing-library/user-event');
        await userEvent.setup().click(within(errore).getByRole('button', { name: /Riprova/ }));

        expect(await titolo('Accedi.')).toBeInTheDocument();
        expect(backend.chiamate).toHaveLength(2);
    });

    test('un errore 500 del backend (o del proxy) non è scambiato per «non autenticato»', async () => {
        simulaBackend({
            'GET /api/auth/io': () =>
                new Response('Error occurred while trying to proxy', { status: 500 }),
        });

        renderizzaApp('/');

        const errore = await screen.findByRole('alert');
        expect(errore).toHaveTextContent('codice 500');
        expect(screen.queryByRole('heading', { name: 'Accedi.' })).not.toBeInTheDocument();
    });
});

describe('navigazione e stati', () => {
    test("un indirizzo inesistente mostra lo stato «vuoto» con il ritorno all'inizio", async () => {
        simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });

        renderizzaApp('/non-esiste');

        expect(await titolo('Pagina non trovata.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Torna all'inizio/ })).toHaveAttribute('href', '/');
    });

    test('da anonimo separa navigazione principale da lingua e accesso account', async () => {
        simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });

        renderizzaApp('/');
        await titolo('Accedi.');

        const navigazione = screen.getByRole('navigation', { name: 'Principale' });
        expect(
            within(navigazione)
                .getAllByRole('link')
                .map((l) => l.textContent),
        ).toEqual(['Esplora', 'Eventi']);
        const account = screen.getByRole('navigation', { name: 'La tua area' });
        expect(within(account).getByRole('combobox', { name: 'Lingua' })).toBeInTheDocument();
        expect(within(account).getAllByRole('link').map((l) => l.textContent)).toEqual(['Registrati', 'Accedi']);
        expect(screen.getByRole('link', { name: /Waveset, pagina iniziale/ })).toBeInTheDocument();
    });

    test("da autenticato la barra ha Esplora, Profilo e il nome dell'utente", async () => {
        simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });

        renderizzaApp('/');
        await titolo('Ciao, Alice.');

        const navigazione = screen.getByRole('navigation', { name: 'Principale' });
        expect(
            within(navigazione)
                .getAllByRole('link')
                .map((l) => l.textContent),
        ).toEqual(['Esplora', 'Eventi']);
        const account = screen.getByRole('navigation', { name: 'La tua area' });
        expect(within(account).getByRole('combobox', { name: 'Lingua' })).toBeInTheDocument();
        expect(within(account).getAllByRole('link').map((l) => l.textContent)).toEqual(['Profilo', 'Impostazioni account', 'Alice ↗']);
        expect(screen.getByRole('link', { name: /Alice ↗/ })).toHaveAttribute('href', '/area');
    });

    test('il collegamento «Vai al contenuto» esiste e punta al contenuto principale', async () => {
        simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });

        renderizzaApp('/');
        await titolo('Accedi.');

        expect(screen.getByRole('link', { name: 'Vai al contenuto' })).toHaveAttribute(
            'href',
            '#contenuto',
        );
        expect(screen.getByRole('main')).toHaveAttribute('id', 'contenuto');
    });
});
