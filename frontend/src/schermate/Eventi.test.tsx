import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import * as maps from '../eventi/maps';
import { differita, json, renderizzaApp, SESSIONE_NON_VALIDA, sessioneDi, simulaBackend } from '../test/backend';

const UNO = { id: 1, titolo: 'Notte Elettrica', data_evento: '2027-02-13', ora_evento: '23:30:00',
    luogo: 'Arca', citta: 'Milano', latitudine: 45.47, longitudine: 9.18,
    lineup: [{ id: 4, nome: 'Nova Circuit', immagine_url: null }] };
const DUE = { ...UNO, id: 2, titolo: 'Alba', latitudine: null, longitudine: null, lineup: [] };

// L'adattatore reale crea il contenuto e collega gli eventi; solo lo SDK è finto.
function sdkSimulato() {
    class Mappa {
        constructor(public contenitore: HTMLElement) {}
        addListener() { return { remove() {} }; }
        fitBounds() {}
        setCenter() {}
        setZoom() {}
        panTo() {}
    }
    class Marker {
        elemento = document.createElement('button');
        zIndex: number | undefined;
        constructor(opzioni: { map: Mappa }) { opzioni.map.contenitore.append(this.elemento); }
        set map(v: Mappa | null) { if (!v) this.elemento.remove(); }
        set title(v: string) { this.elemento.setAttribute('aria-label', v); }
        append(v: HTMLElement) { this.elemento.append(v); }
        addEventListener(_nome: string, cb: () => void) { this.elemento.addEventListener('click', cb); }
        removeEventListener(_nome: string, cb: () => void) { this.elemento.removeEventListener('click', cb); }
    }
    return { maps: { Map: Mappa }, marker: { AdvancedMarkerElement: Marker },
        core: { LatLngBounds: class { extend() {} }, event: { clearInstanceListeners() {} },
            ColorScheme: { DARK: 'DARK', LIGHT: 'LIGHT' } } } as unknown as maps.LibrerieMaps;
}

test.each([
    ['tutti', null], ['seguiti', null],
    ['tutti', 'https://catalogo.waveset.test/nova.jpg'], ['seguiti', 'https://catalogo.waveset.test/nova.jpg'],
] as const)('marker custom (%s, foto %s): lista sincronizzata, click e ritorno conservano evento e filtro', async (filtro, foto) => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'chiave-simulata');
    vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'id-simulato');
    const loader = vi.spyOn(maps, 'caricaMaps').mockResolvedValue(sdkSimulato());
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
        const evento = { ...UNO, lineup: [{ ...UNO.lineup[0], immagine_url: foto }] };
        const altro = { ...evento, id: 2, titolo: 'Alba' };
        const backend = simulaBackend({
            'GET /api/auth/io': json(200, sessioneDi()),
            [`GET /api/eventi?filtro=${filtro}`]: json(200, [evento, altro]),
            'GET /api/eventi/2': json(200, altro),
        });
        const vista = renderizzaApp(`/eventi?filtro=${filtro}`);
        await screen.findByRole('region', { name: 'Elenco degli eventi' });
        const marker = await screen.findByRole('button', { name: 'Alba · Nova Circuit' });
        expect(marker).toHaveTextContent('N');
        if (foto) expect(marker.querySelector('img')).toHaveAttribute('src', foto);
        else expect(marker.querySelector('img')).toBeNull();
        const bottoneLista = screen.getByRole('button', { name: 'Mostra sulla mappa: Alba' });
        await userEvent.setup().click(bottoneLista);
        expect(bottoneLista).toHaveAttribute('aria-pressed', 'true');
        expect(marker).toHaveAccessibleName('Selezionato: Alba · Nova Circuit');
        expect(screen.getByText('2 eventi · Selezionato: Alba')).toHaveAttribute('role', 'status');
        const carta = screen.getByRole('article', { name: 'Alba' });
        await userEvent.setup().click(marker);
        expect(await screen.findByRole('heading', { level: 1, name: 'Alba' })).toBeInTheDocument();
        expect(focus.mock.contexts).toContain(carta);
        const ritorno = screen.getByRole('link', { name: '← Eventi' });
        expect(ritorno).toHaveAttribute('href', `/eventi?filtro=${filtro}`);
        await userEvent.setup().click(ritorno);
        await waitFor(() => expect(screen.getByRole('button', { name: filtro === 'seguiti' ? 'Artisti che seguo' : 'Tutti' })).toHaveAttribute('aria-pressed', 'true'));
        expect(backend.di('GET', '/api/eventi/2')).toHaveLength(1);
        expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
        vista.unmount();
    } finally { focus.mockRestore(); loader.mockRestore(); vi.unstubAllEnvs(); }
});

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
    expect(within(lista).getByRole('link', { name: /Notte Elettrica/ })).toHaveAttribute('href', '/eventi/1?filtro=tutti');
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

test.each(['tutti', 'seguiti'] as const)('elenco → dettaglio → elenco conserva il filtro %s', async (filtro) => {
    const backend = simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        [`GET /api/eventi?filtro=${filtro}`]: json(200, [UNO]),
        'GET /api/eventi/1': json(200, UNO),
    });
    renderizzaApp(`/eventi?filtro=${filtro}`);
    const lista = await screen.findByRole('region', { name: 'Elenco degli eventi' });
    const dettaglio = within(lista).getByRole('link', { name: /Notte Elettrica/ });
    expect(dettaglio).toHaveAttribute('href', `/eventi/1?filtro=${filtro}`);
    await userEvent.setup().click(dettaglio);
    expect(await screen.findByRole('heading', { level: 1, name: 'Notte Elettrica' })).toBeInTheDocument();
    const ritorno = within(screen.getByRole('navigation', { name: 'Percorso negli eventi' })).getByRole('link', { name: '← Eventi' });
    expect(ritorno).toHaveAttribute('href', `/eventi?filtro=${filtro}`);
    await userEvent.setup().click(ritorno);
    expect(await screen.findByRole('region', { name: 'Elenco degli eventi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: filtro === 'seguiti' ? 'Artisti che seguo' : 'Tutti' })).toHaveAttribute('aria-pressed', 'true');
    expect(backend.di('GET', '/api/eventi/1')).toHaveLength(1);
    expect(backend.di('GET', `/api/eventi?filtro=${filtro}`)).toHaveLength(2);
    expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
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

test.each([
    ['?filtro=seguiti', '/eventi?filtro=seguiti', 'seguiti'],
    ['?filtro=tutti', '/eventi?filtro=tutti', 'tutti'],
    ['?filtro=seguiti&altro=valore', '/eventi?filtro=seguiti', 'seguiti'],
    ['', '/eventi', 'tutti'],
    ['?filtro=altro', '/eventi', 'tutti'],
    ['?filtro=', '/eventi', 'tutti'],
    ['?filtro=seguiti&filtro=tutti', '/eventi', 'tutti'],
    ['?filtro=seguiti&filtro=seguiti', '/eventi', 'tutti'],
])('ritorno dal dettaglio con query "%s": destinazione %s', async (query, destinazione, filtro) => {
    const backend = simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/eventi/1': json(200, UNO),
        [`GET /api/eventi?filtro=${filtro}`]: json(200, [UNO]),
    });
    renderizzaApp(`/eventi/1${query}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Notte Elettrica' })).toBeInTheDocument();
    const ritorno = within(screen.getByRole('navigation', { name: 'Percorso negli eventi' })).getByRole('link', { name: '← Eventi' });
    expect(ritorno).toHaveAttribute('href', destinazione);
    await userEvent.setup().click(ritorno);
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: filtro === 'seguiti' ? 'Artisti che seguo' : 'Tutti' })).toHaveAttribute('aria-pressed', 'true');
    expect(backend.di('GET', `/api/eventi?filtro=${filtro}`)).toHaveLength(1);
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
