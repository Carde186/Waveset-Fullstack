import { beforeEach, expect, test, vi } from 'vitest';
import type { Evento } from '../api/eventi';
import type { LibrerieMaps } from './maps';

const loader = vi.hoisted(() => ({ setOptions: vi.fn(), importLibrary: vi.fn() }));
vi.mock('@googlemaps/js-api-loader', () => loader);

const EVENTO: Evento = { id: 5, titolo: 'Live', dataEvento: '2027-02-13', oraEvento: '20:00:00',
    luogo: null, citta: 'Milano', coordinate: { lat: 45, lng: 9 },
    lineup: [{ id: 2, nome: 'Nova', immagineUrl: null }] };
class MappaFinta {
    static create: MappaFinta[] = [];
    options: Record<string, unknown>;
    centro = { lat: 42, lng: 12 };
    zoom = 5;
    callbacks = new Map<string, () => void>();
    constructor(_el: HTMLElement, options: Record<string, unknown>) {
        this.options = options;
        this.centro = options.center as typeof this.centro;
        this.zoom = options.zoom as number;
        MappaFinta.create.push(this);
    }
    addListener(nome: string, cb: () => void) { this.callbacks.set(nome, cb); return { remove: () => this.callbacks.delete(nome) }; }
    getCenter() { return { toJSON: () => this.centro }; }
    getZoom() { return this.zoom; }
    getHeading() { return 0; }
    getTilt() { return 0; }
    setMapTypeId(tipo: string) { this.options.mapTypeId = tipo; }
    setCenter(c: typeof this.centro) { this.centro = c; }
    setZoom(n: number) { this.zoom = n; }
    panTo(c: typeof this.centro) { this.centro = c; }
    fitBounds() { /* Nella prova conta che la mappa sia inizializzata. */ }
}
class MarkerFinto {
    static create: MarkerFinto[] = [];
    map: unknown;
    title: string;
    zIndex: number | undefined;
    callbacks = new Map<string, () => void>();
    pin: PinFinto | undefined;
    constructor(opzioni: { map: unknown; title: string }) {
        this.map = opzioni.map;
        this.title = opzioni.title;
        MarkerFinto.create.push(this);
    }
    addEventListener(nome: string, cb: () => void) { this.callbacks.set(nome, cb); }
    append(pin: PinFinto) { this.pin = pin; }
    removeEventListener(nome: string) { this.callbacks.delete(nome); }
    click() { this.callbacks.get('gmp-click')?.(); }
}
class PinFinto {
    background: string;
    scale = 1;
    glyphText: string;
    constructor(opzioni: { background: string; glyphText: string }) {
        this.background = opzioni.background;
        this.glyphText = opzioni.glyphText;
    }
}
class BoundsFinti { extend() {} }
const api = {
    maps: { Map: MappaFinta }, marker: { AdvancedMarkerElement: MarkerFinto, PinElement: PinFinto },
    core: { ColorScheme: { DARK: 'DARK', LIGHT: 'LIGHT' }, LatLngBounds: BoundsFinti,
        event: { clearInstanceListeners(m: MappaFinta) { m.callbacks.clear(); } } },
} as unknown as LibrerieMaps;

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    MappaFinta.create = [];
    MarkerFinto.create = [];
    loader.importLibrary.mockImplementation(async (nome: 'maps' | 'marker' | 'core') => api[nome]);
});

test('quattro modalità, persistenza e ripristino', async () => {
    const { creaMappa, leggiModalita, salvaModalita } = await import('./maps');
    const elemento = document.createElement('div');
    const seleziona = vi.fn();
    const pronto = vi.fn();
    const m = creaMappa({ contenitore: elemento, api, mapId: 'id-simulato', eventi: [EVENTO],
        modalita: 'standard', selezionato: null, suSelezione: seleziona, suPronto: pronto, suErrore: vi.fn() });
    expect(MappaFinta.create[0]?.options).toMatchObject({ mapTypeId: 'roadmap', colorScheme: 'LIGHT' });
    MappaFinta.create[0]?.callbacks.get('tilesloaded')?.();
    expect(pronto).toHaveBeenCalledOnce();
    expect(MarkerFinto.create[0]?.title).toContain('Nova');
    expect(MarkerFinto.create[0]?.pin?.glyphText).toBe('N');
    MarkerFinto.create[0]?.click();
    expect(seleziona).toHaveBeenCalledWith(5);
    m.seleziona(5);
    expect(MarkerFinto.create[0]?.zIndex).toBe(1000);
    expect(MarkerFinto.create[0]?.pin?.background).toBe('#d8ff58');
    m.modalita('satellite');
    expect(MappaFinta.create).toHaveLength(1);
    expect(MappaFinta.create[0]?.options.mapTypeId).toBe('satellite');
    m.modalita('ibrida');
    expect(MappaFinta.create[0]?.options.mapTypeId).toBe('hybrid');
    const centro = MappaFinta.create[0]!.centro;
    const zoom = MappaFinta.create[0]!.zoom;
    m.modalita('scura');
    expect(MappaFinta.create[1]?.options).toMatchObject({ colorScheme: 'DARK', mapTypeId: 'roadmap', center: centro, zoom });
    m.modalita('standard');
    expect(MappaFinta.create[2]?.options.colorScheme).toBe('LIGHT');
    salvaModalita('ibrida');
    expect(leggiModalita()).toBe('ibrida');
    m.distruggi();
    expect(MarkerFinto.create.every((marker) => marker.map === null && marker.callbacks.size === 0)).toBe(true);
    expect(MappaFinta.create.every((map) => map.callbacks.size === 0)).toBe(true);
});

test('solo eventi con coordinate diventano marker', async () => {
    const { creaMappa } = await import('./maps');
    const m = creaMappa({ contenitore: document.createElement('div'), api, mapId: 'id',
        eventi: [EVENTO, { ...EVENTO, id: 6, coordinate: null }], modalita: 'standard',
        selezionato: null, suSelezione: vi.fn(), suPronto: vi.fn(), suErrore: vi.fn() });
    expect(MarkerFinto.create).toHaveLength(1);
    m.distruggi();
});

test('timeout tile, loader fallito, timeout loader e autenticazione Google fallita', async () => {
    vi.useFakeTimers();
    try {
        const { creaMappa, caricaMaps, ascoltaErroreGoogle, TIMEOUT_MAPPA } = await import('./maps');
        const errore = vi.fn();
        const m = creaMappa({ contenitore: document.createElement('div'), api, mapId: 'id', eventi: [EVENTO],
            modalita: 'standard', selezionato: null, suSelezione: vi.fn(), suPronto: vi.fn(), suErrore: errore });
        await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA);
        expect(errore).toHaveBeenCalledWith('Google Maps non risponde in tempo.');
        m.distruggi();
        loader.importLibrary.mockRejectedValueOnce(new Error('script bloccato'));
        await expect(caricaMaps('chiave-simulata')).rejects.toThrow('script bloccato');
        loader.importLibrary.mockImplementation(() => new Promise(() => {}));
        const attesa = caricaMaps('chiave-simulata');
        const risultato = expect(attesa).rejects.toThrow('in tempo');
        await vi.advanceTimersByTimeAsync(TIMEOUT_MAPPA);
        await risultato;
        const auth = vi.fn();
        const smetti = ascoltaErroreGoogle(auth);
        window.gm_authFailure?.();
        expect(auth).toHaveBeenCalledOnce();
        smetti();
        await expect(caricaMaps('chiave-simulata')).rejects.toThrow('non ha autorizzato');
    } finally { vi.useRealTimers(); }
});
