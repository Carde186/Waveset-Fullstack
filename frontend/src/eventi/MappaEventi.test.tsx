import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Evento } from '../api/eventi';
import { MappaEventi } from './MappaEventi';
import { STORAGE_MAPPA } from './maps';

const loader = vi.hoisted(() => ({ setOptions: vi.fn(), importLibrary: vi.fn() }));
vi.mock('@googlemaps/js-api-loader', () => loader);

const EVENTO: Evento = { id: 5, titolo: 'Live', dataEvento: '2027-02-13', oraEvento: null,
    luogo: null, citta: null, coordinate: { lat: 45, lng: 9 }, lineup: [] };
class MappaFinta {
    static create: MappaFinta[] = [];
    opzioni: Record<string, unknown>;
    eventi = new Map<string, () => void>();
    centro = { lat: 45, lng: 9 };
    constructor(_el: HTMLElement, opzioni: Record<string, unknown>) { this.opzioni = opzioni; MappaFinta.create.push(this); }
    addListener(nome: string, cb: () => void) { this.eventi.set(nome, cb); return { remove: () => this.eventi.delete(nome) }; }
    getCenter() { return { toJSON: () => this.centro }; }
    getZoom() { return 5; }
    getHeading() { return 0; }
    getTilt() { return 0; }
    setMapTypeId(tipo: string) { this.opzioni.mapTypeId = tipo; }
    setCenter(v: typeof this.centro) { this.centro = v; }
    setZoom() {}
    panTo(v: typeof this.centro) { this.centro = v; }
}
class MarkerFinto {
    static create: MarkerFinto[] = [];
    map: unknown;
    title = '';
    zIndex: number | undefined;
    listeners = new Map<string, () => void>();
    constructor(opzioni: { map: unknown }) { this.map = opzioni.map; MarkerFinto.create.push(this); }
    addEventListener(nome: string, cb: () => void) { this.listeners.set(nome, cb); }
    removeEventListener(nome: string) { this.listeners.delete(nome); }
    append() {}
    click() { this.listeners.get('gmp-click')?.(); }
}
class PinFinto { background = ''; scale = 1; }
class BoundsFinti { extend() {} }
const api = { maps: { Map: MappaFinta }, marker: { AdvancedMarkerElement: MarkerFinto, PinElement: PinFinto },
    core: { ColorScheme: { DARK: 'DARK', LIGHT: 'LIGHT' }, LatLngBounds: BoundsFinti,
        event: { clearInstanceListeners(m: MappaFinta) { m.eventi.clear(); } } } };

beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'chiave-simulata');
    vi.stubEnv('VITE_GOOGLE_MAPS_MAP_ID', 'id-simulato');
    loader.importLibrary.mockImplementation(async (nome: 'maps' | 'marker' | 'core') => api[nome]);
    MappaFinta.create = [];
    MarkerFinto.create = [];
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

test('loader fallito: messaggio e retry, lista esterna ancora utilizzabile', async () => {
    loader.importLibrary.mockRejectedValueOnce(new Error('rete'));
    render(<MappaEventi eventi={[EVENTO]} selezionato={null} suSelezione={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Non è possibile caricare Google Maps');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova mappa' }));
    await waitFor(() => expect(MappaFinta.create.length).toBeGreaterThan(0));
});

test('StrictMode: una mappa attiva, marker selezionabile e modalità salvata', async () => {
    const selezione = vi.fn();
    const vista = render(<StrictMode><MappaEventi eventi={[EVENTO]} selezionato={null} suSelezione={selezione} /></StrictMode>);
    await waitFor(() => expect(MappaFinta.create.length).toBeGreaterThan(0));
    MappaFinta.create.at(-1)?.eventi.get('tilesloaded')?.();
    await waitFor(() => expect(screen.queryByText('Carico Google Maps…')).not.toBeInTheDocument());
    MarkerFinto.create.at(-1)?.click();
    expect(selezione).toHaveBeenCalledWith(5);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Modalità mappa' }), 'satellite');
    expect(localStorage.getItem(STORAGE_MAPPA)).toBe('satellite');
    expect(MappaFinta.create.at(-1)?.opzioni.mapTypeId).toBe('satellite');
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Modalità mappa' }), 'scura');
    expect(MappaFinta.create.at(-1)?.opzioni.colorScheme).toBe('DARK');
    vista.unmount();
    expect(MarkerFinto.create.every((m) => m.map === null && m.listeners.size === 0)).toBe(true);
    render(<MappaEventi eventi={[EVENTO]} selezionato={null} suSelezione={selezione} />);
    expect(screen.getByRole('combobox', { name: 'Modalità mappa' })).toHaveValue('scura');
});

test('autenticazione Google fallita: messaggio controllato', async () => {
    render(<MappaEventi eventi={[EVENTO]} selezionato={null} suSelezione={vi.fn()} />);
    await waitFor(() => expect(MappaFinta.create.length).toBeGreaterThan(0));
    fireEvent(window, new Event('focus'));
    window.gm_authFailure?.();
    expect(await screen.findByRole('alert')).toHaveTextContent('non ha autorizzato');
});
