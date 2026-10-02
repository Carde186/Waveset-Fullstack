import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { differita, json, renderizzaApp, SESSIONE_NON_VALIDA, sessioneDi, simulaBackend } from '../test/backend';

const UNO = { id: 1, titolo: 'Notte Elettrica', data_evento: '2027-02-13', ora_evento: '23:30:00',
    luogo: 'Arca', citta: 'Milano', latitudine: 45.47, longitudine: 9.18,
    lineup: [{ id: 4, nome: 'Nova Circuit', immagine_url: null }] };
const DUE = { ...UNO, id: 2, titolo: 'Alba', latitudine: null, longitudine: null, lineup: [] };

test('ospite: lista, lineup locale, coordinate mancanti e dettaglio pubblico', async () => {
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/eventi?filtro=tutti': json(200, [UNO, DUE]),
        'GET /api/eventi/1': json(200, UNO),
    });
    renderizzaApp('/eventi');
    expect(await screen.findByRole('heading', { name: 'Ci vediamo sotto cassa.' })).toBeInTheDocument();
    expect(await screen.findByText('2 eventi')).toBeInTheDocument();
    const lista = screen.getByRole('region', { name: 'Elenco degli eventi' });
    expect(within(lista).getByRole('link', { name: /Notte Elettrica/ })).toHaveAttribute('href', '/eventi/1');
    expect(within(lista).getByRole('link', { name: /Nova Circuit/ })).toHaveAttribute('href', '/artisti/4');
    expect(within(lista).getByText('Posizione sulla mappa non disponibile.')).toBeInTheDocument();
    expect(screen.getByText(/La mappa non è configurata/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Artisti che seguo' })).not.toBeInTheDocument();
    await userEvent.setup().click(within(lista).getByRole('link', { name: /Notte Elettrica/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Notte Elettrica' })).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi/1')).toHaveLength(1);
});

test('filtro seguiti nell’URL: autenticato, vuoto, ritorno a tutti', async () => {
    const backend = simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/eventi?filtro=seguiti': json(200, []),
        'GET /api/eventi?filtro=tutti': json(200, [UNO]),
    });
    renderizzaApp('/eventi?filtro=seguiti');
    expect(await screen.findByRole('heading', { name: 'Nessun evento in arrivo.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Artisti che seguo' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tutti' }));
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi?filtro=tutti')).toHaveLength(1);
});

test('ospite su seguiti: accesso richiesto, nessuna richiesta eventi', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    renderizzaApp('/eventi?filtro=seguiti');
    expect(await screen.findByRole('heading', { name: 'Gli eventi dei tuoi artisti.' })).toBeInTheDocument();
    expect(backend.chiamate.map((c) => c.percorso)).toEqual(['/api/auth/io']);
});

test('filtro sconosciuto e duplicato: 400 locale senza richiesta eventi', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    renderizzaApp('/eventi?filtro=altro&filtro=tutti');
    expect(await screen.findByRole('heading', { name: 'Filtro non valido.' })).toBeInTheDocument();
    expect(backend.chiamate.map((c) => c.percorso)).toEqual(['/api/auth/io']);
});

test('ID non valido e 404: pagina dedicata', async () => {
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/eventi/99': json(404, { messaggio: 'Evento non trovato' }),
    });
    renderizzaApp('/eventi/0');
    expect(await screen.findByRole('heading', { name: 'Evento non trovato.' })).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi/0')).toHaveLength(0);
    renderizzaApp('/eventi/99');
    expect((await screen.findAllByRole('heading', { name: 'Evento non trovato.' })).length).toBeGreaterThan(0);
});

test('errore e retry di elenco, dettaglio e 401 su seguiti', async () => {
    let tentativi = 0;
    const backend = simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/eventi?filtro=seguiti': () => ++tentativi === 1
            ? json(401, { messaggio: 'Sessione non valida' }) : json(200, [UNO]),
    });
    renderizzaApp('/eventi?filtro=seguiti');
    const errore = await screen.findByRole('alert');
    expect(errore).toHaveTextContent('La sessione non è più valida');
    await userEvent.setup().click(within(errore).getByRole('button', { name: /Riprova/ }));
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi?filtro=seguiti')).toHaveLength(2);
});

test('cambio filtro ignora una risposta precedente arrivata tardi', async () => {
    const vecchia = differita<Response>();
    simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/eventi?filtro=tutti': () => vecchia.promessa,
        'GET /api/eventi?filtro=seguiti': json(200, [DUE]),
    });
    renderizzaApp('/eventi');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Artisti che seguo' }));
    expect(await screen.findByRole('link', { name: /Alba/ })).toBeInTheDocument();
    await act(async () => vecchia.risolvi(json(200, [UNO])));
    expect(screen.queryByRole('link', { name: /Notte Elettrica/ })).not.toBeInTheDocument();
});
