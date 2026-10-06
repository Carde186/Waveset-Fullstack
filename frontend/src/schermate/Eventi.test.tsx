import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import * as maps from '../eventi/maps';
import { differita, json, renderizzaApp, SESSIONE_NON_VALIDA, sessioneDi, simulaBackend } from '../test/backend';

const UNO = { id: 1, titolo: 'Notte Elettrica', data_evento: '2027-02-13', ora_evento: '23:30:00',
    luogo: 'Arca', citta: 'Milano', latitudine: 45.47, longitudine: 9.18,
    lineup: [{ id: 4, nome: 'Nova Circuit', immagine_url: null }] };
const nomeFiltro = (filtro: string) => filtro.includes('genere_id=1') ? 'Techno' : filtro.includes('genere_id=2') ? 'House' : filtro.startsWith('seguiti') ? 'Artisti seguiti' : 'Tutti';
const DUE = { ...UNO, id: 2, titolo: 'Alba', latitudine: null, longitudine: null, lineup: [] };

test.each(['tutti', 'tutti&genere_id=1', 'seguiti&genere_id=1'])('aggiorna eventi dopo la pubblicazione conserva il filtro %s e impedisce richieste duplicate', async filtro => {
    const sospesa = differita<Response>();let letture = 0;
    const percorso = `/api/eventi?filtro=${filtro}`;
    const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()),
        [`GET ${percorso}`]: () => ++letture === 1 ? json(200, []) : sospesa.promessa });
    renderizzaApp(`/eventi?filtro=${filtro}`);
    await screen.findByRole('heading', { name: 'Nessun evento in arrivo.' });
    const user = userEvent.setup();
    await user.dblClick(screen.getByRole('button', { name: 'Aggiorna eventi' }));
    expect(screen.getByRole('button', { name: 'Aggiorna eventi' })).toBeDisabled();
    expect(backend.di('GET', percorso)).toHaveLength(2);
    sospesa.risolvi(json(200, [DUE]));
    await screen.findByRole('article', { name: 'Alba' });
    expect(screen.getByRole('button', { name: nomeFiltro(filtro) })).toHaveAttribute('aria-pressed', 'true');
    expect(backend.chiamate.every(c => c.metodo === 'GET')).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('button', { name: 'Refresh events' })).toBeEnabled();
    expect(backend.di('GET', percorso)).toHaveLength(2);
});

test('cambio filtro durante aggiornamento ignora la risposta precedente', async () => {
    const sospesa = differita<Response>();let letture = 0;
    simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/eventi?filtro=tutti': () => ++letture === 1 ? json(200, []) : sospesa.promessa,
        'GET /api/eventi?filtro=tutti&genere_id=1': json(200, [DUE]) });
    renderizzaApp('/eventi');const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Aggiorna eventi' }));
    await waitFor(() => expect(letture).toBe(2));
    await user.click(screen.getByRole('button', { name: 'Techno' }));
    await screen.findByRole('article', { name: 'Alba' });
    await act(async () => sospesa.risolvi(json(200, [UNO])));
    expect(screen.getByRole('article', { name: 'Alba' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Notte Elettrica' })).not.toBeInTheDocument();
});

test.each(['/eventi', '/eventi/1'])('foto lineup su %s: presente, errore e segnaposto', async percorso => {
    const foto = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    const evento = { ...UNO, lineup: [{ ...UNO.lineup[0], immagine_url: foto }, { id: 5, nome: 'Secondario', immagine_url: null }] };
    simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), 'GET /api/eventi?filtro=tutti': json(200, [evento]), 'GET /api/eventi/1': json(200, evento) });
    renderizzaApp(percorso);
    const lista = await screen.findByRole('list', { name: 'Lineup di Notte Elettrica' });
    const immagine = within(lista).getByRole('img', { name: 'Foto di Nova Circuit' });
    expect(immagine).toHaveAttribute('src', foto); expect(immagine).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(within(lista).getAllByRole('link').map(a => a.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Nova Circuit'), expect.stringContaining('Secondario')]));
    expect(within(lista).queryByRole('img', { name: 'Foto di Secondario' })).not.toBeInTheDocument();
    fireEvent.error(immagine); expect(within(lista).queryByRole('img')).not.toBeInTheDocument();
    expect(within(lista).getAllByText('Grafica Club')).toHaveLength(2);
});

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
    ['tutti', null], ['tutti&genere_id=1', null],
    ['tutti', 'https://catalogo.waveset.test/nova.jpg'], ['tutti&genere_id=1', 'https://catalogo.waveset.test/nova.jpg'],
    ['seguiti', null], ['seguiti&genere_id=1', null],
    ['seguiti', 'https://catalogo.waveset.test/nova.jpg'], ['seguiti&genere_id=1', 'https://catalogo.waveset.test/nova.jpg'],
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
        await waitFor(() => expect(screen.getByRole('button', { name: nomeFiltro(filtro) })).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.getByRole('button', { name: 'Artisti seguiti' })).toHaveAttribute('aria-pressed', String(filtro.startsWith('seguiti')));
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
    expect(screen.getByRole('button', { name: 'Artisti seguiti' })).toBeDisabled();
    await userEvent.setup().click(within(lista).getByRole('link', { name: /Notte Elettrica/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Notte Elettrica' })).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi/1')).toHaveLength(1);
});

test('genere nell’URL: pubblico, vuoto, ritorno a tutti', async () => {
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/eventi?filtro=tutti&genere_id=1': json(200, []),
        'GET /api/eventi?filtro=tutti': json(200, [UNO]),
    });
    renderizzaApp('/eventi?filtro=tutti&genere_id=1');
    expect(await screen.findByRole('heading', { name: 'Nessun evento in arrivo.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Techno' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tutti' }));
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi?filtro=tutti')).toHaveLength(1);
});

test('seguiti combinabile con genere: attiva/disattiva senza perdere il genere, Tutti azzera entrambi', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/eventi?filtro=tutti&genere_id=1': json(200, [UNO, DUE]),
        'GET /api/eventi?filtro=seguiti&genere_id=1': json(200, [UNO]),
        'GET /api/eventi?filtro=seguiti&genere_id=2': json(200, []),
        'GET /api/eventi?filtro=tutti&genere_id=2': json(200, [DUE]),
        'GET /api/eventi?filtro=tutti': json(200, [UNO, DUE]) });
    renderizzaApp('/eventi?filtro=tutti&genere_id=1'); const user = userEvent.setup();
    await screen.findByText('2 eventi');
    await user.click(screen.getByRole('button', { name: 'Artisti seguiti' }));
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Techno' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Artisti seguiti' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'House' }));
    await screen.findByRole('heading', { name: 'Nessun evento in arrivo.' });
    expect(screen.getByText(/Non ci sono eventi pubblicati in arrivo per gli artisti che segui/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Artisti seguiti' }));
    expect(await screen.findByRole('link', { name: /Alba/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'House' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Tutti' }));
    await screen.findByText('2 eventi');
    expect(screen.getByRole('button', { name: 'House' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Artisti seguiti' })).toHaveAttribute('aria-pressed', 'false');
    expect(backend.di('GET', '/api/eventi?filtro=seguiti&genere_id=1')).toHaveLength(1);
});

test('filtro seguiti attende identità e rimuove i dati personali dopo sessione scaduta', async () => {
    const attesa = differita<Response>(); let controlli = 0;
    const backend = simulaBackend({ 'GET /api/auth/io': () => ++controlli === 1 ? attesa.promessa : SESSIONE_NON_VALIDA(),
        'GET /api/eventi?filtro=seguiti': json(401, {}) });
    renderizzaApp('/eventi?filtro=seguiti');
    await screen.findByText('Controllo la sessione…');
    expect(backend.di('GET', '/api/eventi?filtro=seguiti')).toHaveLength(0);
    await act(async () => attesa.risolvi(json(200, sessioneDi())));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Verifica la sessione' }));
    expect(await screen.findByRole('heading', { name: 'Gli eventi dei tuoi artisti.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Artisti seguiti' })).toBeDisabled();
});

test.each(['tutti', 'tutti&genere_id=1', 'seguiti', 'seguiti&genere_id=1'] as const)('elenco → dettaglio → elenco conserva il filtro %s', async (filtro) => {
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
    expect(screen.getByRole('button', { name: nomeFiltro(filtro) })).toHaveAttribute('aria-pressed', 'true');
    expect(backend.di('GET', '/api/eventi/1')).toHaveLength(1);
    expect(backend.di('GET', `/api/eventi?filtro=${filtro}`)).toHaveLength(2);
    expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
});

test('ospite su URL seguiti: filtro disabilitato e invito al login senza richiesta privata', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), 'GET /api/eventi?filtro=tutti': json(200, [UNO]) });
    renderizzaApp('/eventi?filtro=seguiti');
    expect(await screen.findByRole('heading', { name: 'Gli eventi dei tuoi artisti.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Artisti seguiti' })).toBeDisabled();
    expect(backend.di('GET', '/api/eventi?filtro=seguiti')).toHaveLength(0);
});

test('filtro sconosciuto e duplicato: 400 locale senza richiesta eventi', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    renderizzaApp('/eventi?filtro=altro&filtro=tutti');
    expect(await screen.findByRole('heading', { name: 'Filtro non valido.' })).toBeInTheDocument();
    expect(backend.chiamate.some(c => c.percorso.startsWith('/api/eventi?'))).toBe(false);
});

test.each([
    ['?filtro=seguiti', '/eventi?filtro=seguiti', 'seguiti'],
    ['?filtro=seguiti&genere_id=1', '/eventi?filtro=seguiti&genere_id=1', 'seguiti&genere_id=1'],
    ['?filtro=tutti', '/eventi?filtro=tutti', 'tutti'],
    ['?filtro=tutti&genere_id=1&altro=valore', '/eventi?filtro=tutti&genere_id=1', 'tutti&genere_id=1'],
    ['?genere_id=2', '/eventi?filtro=tutti&genere_id=2', 'tutti&genere_id=2'],
    ['?genere_id=-1', '/eventi', 'tutti'],
    ['?genere_id=1&genere_id=2', '/eventi', 'tutti'],
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
    expect(screen.getByRole('button', { name: nomeFiltro(filtro) })).toHaveAttribute('aria-pressed', 'true');
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

test('errore e retry dell’elenco per genere', async () => {
    let tentativi = 0;
    const backend = simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/eventi?filtro=tutti&genere_id=1': () => ++tentativi === 1
            ? json(503, { messaggio: 'Non disponibile' }) : json(200, [UNO]),
    });
    renderizzaApp('/eventi?filtro=tutti&genere_id=1');
    const errore = await screen.findByRole('alert');
    expect(errore).toHaveTextContent('Gli eventi non sono disponibili.');
    await userEvent.setup().click(within(errore).getByRole('button', { name: /Riprova/ }));
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi?filtro=tutti&genere_id=1')).toHaveLength(2);
});

test('cambio filtro ignora una risposta precedente arrivata tardi', async () => {
    const vecchia = differita<Response>();
    simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/eventi?filtro=tutti': () => vecchia.promessa,
        'GET /api/eventi?filtro=tutti&genere_id=1': json(200, [DUE]),
    });
    renderizzaApp('/eventi');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Techno' }));
    expect(await screen.findByRole('link', { name: /Alba/ })).toBeInTheDocument();
    await act(async () => vecchia.risolvi(json(200, [UNO])));
    expect(screen.queryByRole('link', { name: /Notte Elettrica/ })).not.toBeInTheDocument();
});

test.each(['/eventi', '/eventi/1'])('copertina evento su %s: presente, assente e in errore resta separata dalla lineup', async percorso => {
    const copertina = 'https://s1.ticketm.net/dam/a/evento.jpg';
    const fotoArtista = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    const evento = { ...UNO, immagine_url: copertina, immagine: { url: copertina, width: 1024, height: 576, ratio: '16_9', fallback: false, source: 'ticketmaster' },
        lineup: [{ ...UNO.lineup[0], immagine_url: fotoArtista }] };
    simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), 'GET /api/eventi?filtro=tutti': json(200, [evento, DUE]), 'GET /api/eventi/1': json(200, evento) });
    renderizzaApp(percorso);
    const immagine = await screen.findByRole('img', { name: 'Copertina di Notte Elettrica' });
    expect(immagine).toHaveAttribute('src', copertina);
    expect(immagine).toHaveAttribute('loading', percorso === '/eventi' ? 'lazy' : 'eager');
    expect(immagine).toHaveAttribute('referrerpolicy', 'no-referrer');
    if (percorso === '/eventi/1') {
        const hero = screen.getByRole('heading', { level: 1, name: UNO.titolo }).closest('[class*="vetrina"]');
        expect(hero).toContainElement(immagine);
        expect(hero?.querySelector('[class*="visualeEstesa"]')).toContainElement(immagine);
        expect(hero?.querySelector('[aria-hidden="true"]')).toBeNull();
        expect(screen.getAllByRole('img', { name: 'Copertina di Notte Elettrica' })).toHaveLength(1);
    }
    const lineup = screen.getByRole('list', { name: 'Lineup di Notte Elettrica' });
    expect(within(lineup).getByRole('img', { name: 'Foto di Nova Circuit' })).toHaveAttribute('src', fotoArtista);
    if (percorso === '/eventi') expect(within(screen.getByRole('article', { name: 'Alba' })).getByText('Copertina evento non disponibile')).toBeInTheDocument();
    fireEvent.error(immagine);
    expect(screen.queryByRole('img', { name: 'Copertina di Notte Elettrica' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Copertina evento non disponibile').length).toBeGreaterThan(0);
    expect(within(lineup).getByRole('img')).toHaveAttribute('src', fotoArtista);
    if (percorso === '/eventi/1') expect(screen.getByRole('heading', { level: 1, name: UNO.titolo }).closest('[class*="vetrina"]'))
        .toContainElement(screen.getByText('Copertina evento non disponibile'));
});

test('dettaglio senza copertina usa segnaposto evento anche quando la foto artista esiste', async () => {
    const evento = { ...UNO, immagine_url: null, lineup: [{ ...UNO.lineup[0], immagine_url: 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg' }] };
    simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), 'GET /api/eventi/1': json(200, evento) });
    renderizzaApp('/eventi/1');
    expect(await screen.findByText('Copertina evento non disponibile')).toBeInTheDocument();
    const hero = screen.getByRole('heading', { level: 1, name: UNO.titolo }).closest('[class*="vetrina"]');
    expect(hero?.querySelector('[class*="visualeEstesa"]')).toContainElement(screen.getByText('Copertina evento non disponibile'));
    expect(hero?.querySelector('[class*="arte"]')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Copertina di Notte Elettrica' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Foto di Nova Circuit' })).toBeInTheDocument();
});

test('evento approvato dall’API pubblica presente in lista e marker; evento rifiutato escluso', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'chiave-simulata');
    vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'id-simulato');
    const loader = vi.spyOn(maps, 'caricaMaps').mockResolvedValue(sdkSimulato());
    try {
        const approvato = { ...UNO, titolo: 'Ticketmaster approvato Ollama', fonte: 'ticketmaster', stato_fonte: 'onsale', ultimo_controllo: '2026-10-04T10:00:00Z', assente_fonte: false, modifiche_fonte: false };
        simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), 'GET /api/eventi?filtro=tutti': json(200, [approvato]) });
        renderizzaApp('/eventi');
        expect(await screen.findByRole('article', { name: approvato.titolo })).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Ticketmaster approvato Ollama · Nova Circuit' })).toBeInTheDocument();
        expect(screen.queryByRole('article', { name: 'Ticketmaster rifiutato Ollama' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Ticketmaster rifiutato Ollama/ })).not.toBeInTheDocument();
    } finally { loader.mockRestore(); vi.unstubAllEnvs(); }
});


test.each(['genere_id=0', 'genere_id=-1', 'genere_id=1&genere_id=2', 'genere_id=999'])('genere non valido %s: nessuna richiesta eventi', async query => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    renderizzaApp(`/eventi?${query}`);
    await screen.findByRole('heading', { name: 'Filtro non valido.' });
    expect(backend.chiamate.some(c => c.percorso.startsWith('/api/eventi?'))).toBe(false);
});
test('generi non disponibili: Tutti resta utilizzabile e il caricamento generi può ripartire', async () => {
    let tentativi = 0;
    simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), 'GET /api/eventi?filtro=tutti': json(200, [UNO]),
        'GET /api/generi': () => ++tentativi === 1 ? json(503, {}) : json(200, [{ id: 1, nome: 'Techno' }]) });
    renderizzaApp('/eventi');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Generi non disponibili.');
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    await userEvent.setup().click(within(alert).getByRole('button', { name: /Riprova/ }));
    expect(await screen.findByRole('button', { name: 'Techno' })).toBeInTheDocument();
});
