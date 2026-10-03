import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Evento } from '../api/eventi';
import { MappaEventi } from './MappaEventi';
import { STORAGE_MAPPA, TIMEOUT_MAPPA } from './maps';

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

test('timeout transitorio: recupera automaticamente senza ricaricare lo SDK', async () => {
    vi.useFakeTimers();
    try {
        render(<MappaEventi eventi={[EVENTO]} selezionato={5} suSelezione={vi.fn()} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(MappaFinta.create).toHaveLength(1);
        const importazioni = loader.importLibrary.mock.calls.length;
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA); });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByText('Carico Google Maps…')).toBeInTheDocument();
        expect(MarkerFinto.create[0]?.map).toBeNull();
        fireEvent.change(screen.getByRole('combobox', { name: 'Modalità mappa' }), { target: { value: 'scura' } });
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(MappaFinta.create).toHaveLength(2);
        expect(MappaFinta.create.at(-1)?.opzioni.colorScheme).toBe('DARK');
        expect(loader.importLibrary).toHaveBeenCalledTimes(importazioni);
        expect(MarkerFinto.create.at(-1)?.zIndex).toBe(1000);
        await act(async () => { MappaFinta.create.at(-1)?.eventi.get('tilesloaded')?.(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA * 2); });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByText('Carico Google Maps…')).not.toBeInTheDocument();
        expect(MappaFinta.create).toHaveLength(2);
    } finally { vi.useRealTimers(); }
});

test('rete persistentemente assente: un solo retry automatico, poi fallback e retry manuale', async () => {
    vi.useFakeTimers();
    try {
        render(<MappaEventi eventi={[EVENTO]} selezionato={null} suSelezione={vi.fn()} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA * 2 + 500); });
        expect(MappaFinta.create).toHaveLength(2);
        expect(screen.getByRole('alert')).toHaveTextContent('Google Maps non risponde in tempo');
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA * 3); });
        expect(MappaFinta.create).toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: 'Riprova mappa' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(MappaFinta.create).toHaveLength(3);
        await act(async () => { MappaFinta.create.at(-1)?.eventi.get('tilesloaded')?.(); });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
});

test('smontaggio durante attesa retry: nessuna nuova mappa', async () => {
    vi.useFakeTimers();
    try {
        const vista = render(<MappaEventi eventi={[EVENTO]} selezionato={null} suSelezione={vi.fn()} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA); });
        vista.unmount();
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA * 2); });
        expect(MappaFinta.create).toHaveLength(1);
        expect(MarkerFinto.create.every((m) => m.map === null && m.listeners.size === 0)).toBe(true);
    } finally { vi.useRealTimers(); }
});

test('autenticazione Google fallita: errore immediato senza retry automatico', async () => {
    vi.useFakeTimers();
    try {
        render(<MappaEventi eventi={[EVENTO]} selezionato={null} suSelezione={vi.fn()} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA); });
        expect(MappaFinta.create).toHaveLength(1);
        await act(async () => { window.gm_authFailure?.(); });
        expect(screen.getByRole('alert')).toHaveTextContent('non ha autorizzato');
        await act(async () => { await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA * 3); });
        expect(MappaFinta.create).toHaveLength(1);
    } finally { vi.useRealTimers(); }
});
