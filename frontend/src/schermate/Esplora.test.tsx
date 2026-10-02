import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import {
    differita,
    json,
    renderizzaApp,
    SESSIONE_NON_VALIDA,
    simulaBackend,
} from '../test/backend';
import { ARTISTI, BRANO, GENERI } from '../test/catalogo';

afterEach(() => vi.useRealTimers());

function apri(rotte: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/generi': json(200, GENERI),
        'GET /api/artisti': json(200, ARTISTI),
        ...rotte,
    });
    const pagina = renderizzaApp('/esplora');
    return { backend, pagina };
}
const campo = () => screen.getByRole('searchbox', { name: 'Cerca nel catalogo locale' });
const cerca = (valore: string) => fireEvent.change(campo(), { target: { value: valore } });
async function tempo(ms: number) {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

test('pagina pubblica, catalogo locale e navigazione all’artista, senza immagini Picsum o scritture', async () => {
    const { backend } = apri();
    expect(screen.getByRole('heading', { level: 1, name: 'Esplora.' })).toBeInTheDocument();
    const artista = await screen.findByRole('link', { name: 'Apri artista Nova Circuit' });
    expect(artista).toHaveAttribute('href', '/artisti/1');
    expect(screen.getByRole('button', { name: 'Tutti' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('img[src*="picsum"]')).toBeNull();
    expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
    expect(backend.di('GET', '/api/generi')).toHaveLength(1);
    expect(backend.di('GET', '/api/artisti')).toHaveLength(1);
});

test('Esplora non è bloccata dal controllo della sessione', async () => {
    const io = differita<Response>();
    apri({ 'GET /api/auth/io': () => io.promessa });
    expect(
        await screen.findByRole('link', { name: 'Apri artista Nova Circuit' }),
    ).toBeInTheDocument();
});

test('filtro genere solo sull’elenco; Tutti ripristina il catalogo', async () => {
    const utente = userEvent.setup();
    const { backend } = apri({ 'GET /api/artisti?genere_id=2': json(200, []) });
    await screen.findByRole('link', { name: 'Apri artista Nova Circuit' });
    await utente.click(screen.getByRole('button', { name: 'House' }));
    expect(
        await screen.findByRole('heading', { name: 'Nessun artista disponibile.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'House' })).toHaveAttribute('aria-pressed', 'true');
    expect(backend.di('GET', '/api/artisti?genere_id=2')).toHaveLength(1);
    expect(screen.getByText(/Il genere filtra solo questo elenco/)).toBeInTheDocument();
    await utente.click(screen.getByRole('button', { name: 'Tutti' }));
    expect(
        await screen.findByRole('link', { name: 'Apri artista Nova Circuit' }),
    ).toBeInTheDocument();
});

test('un filtro lento non sovrascrive un filtro più recente', async () => {
    const vecchia = differita<Response>();
    const nuova = differita<Response>();
    const { backend } = apri({
        'GET /api/artisti?genere_id=1': () => vecchia.promessa,
        'GET /api/artisti?genere_id=2': () => nuova.promessa,
    });
    await screen.findByRole('link', { name: 'Apri artista Nova Circuit' });
    const utente = userEvent.setup();
    await utente.click(screen.getByRole('button', { name: 'Techno' }));
    await waitFor(() => expect(backend.di('GET', '/api/artisti?genere_id=1')).toHaveLength(1));
    await utente.click(screen.getByRole('button', { name: 'House' }));
    await waitFor(() => expect(backend.di('GET', '/api/artisti?genere_id=2')).toHaveLength(1));
    await act(async () =>
        nuova.risolvi(json(200, [{ id: 2, nome: 'Sunset Grid', immagine_url: null }])),
    );
    expect(
        await screen.findByRole('link', { name: 'Apri artista Sunset Grid' }),
    ).toBeInTheDocument();
    await act(async () => vecchia.risolvi(json(200, ARTISTI)));
    expect(
        screen.queryByRole('link', { name: 'Apri artista Nova Circuit' }),
    ).not.toBeInTheDocument();
});

test('errore generi con riprova; errore artisti non diventa un elenco vuoto', async () => {
    let tentativo = 0;
    apri({
        'GET /api/generi': () => (++tentativo === 1 ? json(500, {}) : json(200, GENERI)),
        'GET /api/artisti': json(500, {}),
    });
    const utente = userEvent.setup();
    const errore = await screen.findByRole('alert');
    expect(errore).toHaveTextContent('codice 500');
    await utente.click(within(errore).getByRole('button', { name: /Riprova/ }));
    await screen.findByRole('button', { name: 'Techno' });
    expect(await screen.findByRole('alert')).toHaveTextContent('codice 500');
    expect(screen.queryByText('Nessun artista disponibile.')).not.toBeInTheDocument();
});

test('debounce di 300 ms, nessuna ricerca intermedia o filtro genere aggiunto', async () => {
    vi.useFakeTimers();
    const { backend } = apri({
        'GET /api/ricerca?q=nova': json(200, { artisti: ARTISTI, brani: [BRANO] }),
    });
    cerca('no');
    await tempo(200);
    cerca('nova');
    await tempo(299);
    expect(backend.chiamate.filter((c) => c.percorso.startsWith('/api/ricerca'))).toHaveLength(0);
    await tempo(1);
    expect(backend.di('GET', '/api/ricerca?q=nova')).toHaveLength(1);
    const risultati = within(screen.getByRole('region', { name: 'Risultati della ricerca' }));
    expect(risultati.getByRole('heading', { name: 'Artisti' })).toBeInTheDocument();
    expect(risultati.getByRole('heading', { name: 'Brani' })).toBeInTheDocument();
    expect(risultati.getByRole('link', { name: 'Voltaggio' })).toHaveAttribute('href', '/brani/11');
});

test('ricerca separata dal genere selezionato', async () => {
    const { backend } = apri({
        'GET /api/artisti?genere_id=2': json(200, []),
        'GET /api/ricerca?q=nova': json(200, { artisti: ARTISTI, brani: [] }),
    });
    const utente = userEvent.setup();
    await screen.findByRole('link', { name: 'Apri artista Nova Circuit' });
    await utente.click(screen.getByRole('button', { name: 'House' }));
    await screen.findByText('Nessun artista disponibile.');
    await utente.type(campo(), 'nova');
    expect(
        await screen.findByRole('link', { name: 'Apri artista Nova Circuit' }),
    ).toBeInTheDocument();
    expect(backend.di('GET', '/api/ricerca?q=nova')).toHaveLength(1);
    expect(
        backend.chiamate
            .filter((c) => c.percorso.startsWith('/api/ricerca'))
            .every((c) => !c.percorso.includes('genere')),
    ).toBe(true);
});

test('limiti ricerca: un carattere, incolla oltre 100, esattamente 100 e cancellazione', async () => {
    vi.useFakeTimers();
    const cento = 'a'.repeat(100);
    const { backend } = apri({
        [`GET /api/ricerca?q=${cento}`]: json(200, { artisti: [], brani: [] }),
    });
    expect(campo()).toHaveAttribute('maxlength', '100');
    cerca('a');
    await tempo(400);
    expect(screen.getByText('Scrivi almeno 2 caratteri.')).toBeInTheDocument();
    cerca('a'.repeat(101));
    await tempo(400);
    expect(campo()).toHaveAttribute('aria-invalid', 'true');
    expect(backend.chiamate.filter((c) => c.percorso.startsWith('/api/ricerca'))).toHaveLength(0);
    cerca(cento);
    await tempo(300);
    expect(screen.getByRole('heading', { name: 'Nessun risultato.' })).toBeInTheDocument();
    cerca('');
    await tempo(400);
    expect(
        screen.queryByRole('region', { name: 'Risultati della ricerca' }),
    ).not.toBeInTheDocument();
    expect(backend.chiamate.filter((c) => c.percorso.startsWith('/api/ricerca'))).toHaveLength(1);
});

test('risposte ed errori di ricerche superate non sostituiscono il risultato corrente', async () => {
    vi.useFakeTimers();
    const prima = differita<Response>();
    const seconda = differita<Response>();
    apri({
        'GET /api/ricerca?q=no': () => prima.promessa,
        'GET /api/ricerca?q=vo': () => seconda.promessa,
    });
    cerca('no');
    await tempo(300);
    cerca('vo');
    await tempo(300);
    await act(async () => seconda.risolvi(json(200, { artisti: [], brani: [BRANO] })));
    expect(screen.getByRole('link', { name: 'Voltaggio' })).toBeInTheDocument();
    await act(async () => prima.risolvi(json(500, {})));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltaggio' })).toBeInTheDocument();
});

test('ricerca A → B → A: un nuovo tentativo non mostra la vecchia risposta A', async () => {
    vi.useFakeTimers();
    const secondaA = differita<Response>();
    const rispostaB = differita<Response>();
    let richiesteA = 0;
    apri({
        'GET /api/ricerca?q=no': () =>
            ++richiesteA === 1 ? json(200, { artisti: [], brani: [BRANO] }) : secondaA.promessa,
        'GET /api/ricerca?q=vo': () => rispostaB.promessa,
    });
    cerca('no');
    await tempo(300);
    expect(screen.getByRole('link', { name: 'Voltaggio' })).toBeInTheDocument();
    cerca('vo');
    await tempo(300);
    cerca('no');
    expect(screen.queryByRole('link', { name: 'Voltaggio' })).not.toBeInTheDocument();
    await tempo(300);
    await act(async () =>
        secondaA.risolvi(
            json(200, { artisti: [], brani: [{ ...BRANO, id: 12, titolo: 'Rete Oscura' }] }),
        ),
    );
    expect(screen.getByRole('link', { name: 'Rete Oscura' })).toBeInTheDocument();
    expect(richiesteA).toBe(2);
    await act(async () => rispostaB.risolvi(json(500, {})));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('svuotare o smontare annulla il debounce e ignora una risposta già in viaggio', async () => {
    vi.useFakeTimers();
    const risposta = differita<Response>();
    const { backend, pagina } = apri({ 'GET /api/ricerca?q=no': () => risposta.promessa });
    cerca('ab');
    await tempo(100);
    cerca('');
    await tempo(400);
    expect(backend.di('GET', '/api/ricerca?q=ab')).toHaveLength(0);
    cerca('no');
    await tempo(300);
    cerca('');
    await act(async () => risposta.risolvi(json(200, { artisti: [], brani: [BRANO] })));
    expect(screen.queryByRole('link', { name: 'Voltaggio' })).not.toBeInTheDocument();
    cerca('nu');
    pagina.unmount();
    await tempo(400);
    expect(backend.di('GET', '/api/ricerca?q=nu')).toHaveLength(0);
});

test('ricerca fallita: riprova la stessa query e distingue dati invalidi da nessun risultato', async () => {
    let tentativo = 0;
    const { backend } = apri({
        'GET /api/ricerca?q=no': () =>
            ++tentativo === 1 ? json(200, {}) : json(200, { artisti: [], brani: [] }),
    });
    cerca('no');
    const errore = await screen.findByRole('alert');
    expect(errore).toHaveTextContent('I dati ricevuti non sono leggibili');
    await userEvent.setup().click(within(errore).getByRole('button', { name: /Riprova/ }));
    expect(await screen.findByRole('heading', { name: 'Nessun risultato.' })).toBeInTheDocument();
    expect(backend.di('GET', '/api/ricerca?q=no')).toHaveLength(2);
});
