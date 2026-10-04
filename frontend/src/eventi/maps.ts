import { t, leggiLingua, type Chiave } from '../localizzazione/lingua';
import type { Evento } from '../api/eventi';
import stileMarker from './MarkerEvento.module.css';

export const MODALITA_MAPPA = ['standard', 'scura', 'satellite', 'ibrida'] as const;
export type ModalitaMappa = typeof MODALITA_MAPPA[number];
export const STORAGE_MAPPA = 'waveset.eventi.modalitaMappa';
export const TIMEOUT_MAPPA = 12000;
export function leggiModalita(): ModalitaMappa {
    try {
        const v = localStorage.getItem(STORAGE_MAPPA);
        return MODALITA_MAPPA.find((m) => m === v) ?? 'standard';
    } catch { return 'standard'; }
}
export function salvaModalita(v: ModalitaMappa) {
    try { localStorage.setItem(STORAGE_MAPPA, v); } catch { /* Storage disabilitato: la scelta resta in memoria. */ }
}

export interface LibrerieMaps {
    maps: google.maps.MapsLibrary;
    marker: google.maps.MarkerLibrary;
    core: google.maps.CoreLibrary;
}
let configurato = false;
let librerie: Promise<LibrerieMaps> | null = null;
let autenticazioneFallita = false;
const ascoltatoriAuth = new Set<() => void>();
let authInstallata = false;

export function ascoltaErroreGoogle(ascoltatore: () => void): () => void {
    if (!authInstallata) {
        const precedente = window.gm_authFailure;
        window.gm_authFailure = () => {
            autenticazioneFallita = true;
            for (const avvisa of ascoltatoriAuth) avvisa();
            precedente?.();
        };
        authInstallata = true;
    }
    ascoltatoriAuth.add(ascoltatore);
    if (autenticazioneFallita) ascoltatore();
    return () => { ascoltatoriAuth.delete(ascoltatore); };
}

// Una sola configurazione per pagina e una promessa condivisa anche nei due
// setup di StrictMode. Il timeout di un consumatore non annulla altri consumer.
export async function caricaMaps(chiave: string): Promise<LibrerieMaps> {
    if (autenticazioneFallita) throw new Error('maps.auth');
    if (!librerie) {
        librerie = (async () => {
            const { setOptions, importLibrary } = await import('@googlemaps/js-api-loader');
            if (!configurato) {
                setOptions({ key: chiave, v: 'weekly', language: leggiLingua(), region: 'IT' });
                configurato = true;
            }
            const [maps, marker, core] = await Promise.all([
                importLibrary('maps'), importLibrary('marker'), importLibrary('core'),
            ]);
            return { maps, marker, core };
        })().catch((errore: unknown) => { librerie = null; throw errore; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const risultato = await Promise.race([
            librerie,
            new Promise<never>((_, rifiuta) => {
                timer = setTimeout(() => rifiuta(new Error('maps.timeout')), TIMEOUT_MAPPA);
            }),
        ]);
        if (autenticazioneFallita) throw new Error('maps.auth');
        return risultato;
    } finally { clearTimeout(timer); }
}

function contenutoMarker(evento: Evento): HTMLElement {
    const artista = evento.lineup[0];
    const contenuto = document.createElement('span');
    contenuto.className = stileMarker.marker!;
    contenuto.setAttribute('aria-hidden', 'true'); // Il titolo accessibile è sul marker Google.
    const avatar = document.createElement('span');
    avatar.className = stileMarker.avatar!;
    const iniziale = document.createElement('span');
    iniziale.textContent = Array.from(artista?.nome.trim() ?? '')[0]?.toLocaleUpperCase('it') ?? '♪';
    avatar.append(iniziale);
    if (artista?.immagineUrl) {
        const foto = document.createElement('img');
        foto.alt = '';
        foto.width = 36;
        foto.height = 36;
        foto.decoding = 'async';
        foto.setAttribute('referrerpolicy', 'no-referrer');
        // L'iniziale resta sotto la foto anche durante il caricamento.
        foto.addEventListener('error', () => foto.remove(), { once: true });
        foto.src = artista.immagineUrl;
        avatar.append(foto);
    }
    contenuto.append(avatar);
    return contenuto;
}

// Adattatore imperativo: il cambio modalità preserva la vista e non avvia
// richieste al backend. Nessun HTML della risposta API viene inserito nella mappa.
export function creaMappa({ contenitore, api, mapId, eventi, modalita, selezionato, suSelezione, suPronto, suErrore }: {
    contenitore: HTMLElement; api: LibrerieMaps; mapId: string; eventi: Evento[];
    modalita: ModalitaMappa; selezionato: number | null;
    suSelezione: (id: number) => void; suPronto: () => void; suErrore: (messaggio: Chiave) => void;
}) {
    let mappa: google.maps.Map;
    let modo = modalita;
    let scelta = selezionato;
    let distrutta = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listenerTile: google.maps.MapsEventListener | undefined;
    let markers: { evento: Evento; marker: google.maps.marker.AdvancedMarkerElement; contenuto: HTMLElement; click: () => void }[] = [];

    function rimuoviMappa() {
        clearTimeout(timer);
        listenerTile?.remove();
        for (const { marker, click } of markers) {
            marker.removeEventListener('gmp-click', click);
            marker.map = null;
        }
        markers = [];
        if (mappa) api.core.event.clearInstanceListeners(mappa);
        contenitore.replaceChildren();
    }
    function evidenzia() {
        for (const { evento, marker, contenuto } of markers) {
            marker.zIndex = evento.id === scelta ? 1000 : undefined;
            marker.title = `${evento.id === scelta ? t('maps.selected') : ''}${evento.titolo}${evento.lineup[0] ? ` · ${evento.lineup[0].nome}` : ''}`;
            contenuto.classList.toggle(stileMarker.selezionato!, evento.id === scelta);
        }
    }
    function tipo(m: ModalitaMappa) {
        return m === 'satellite' ? 'satellite' : m === 'ibrida' ? 'hybrid' : 'roadmap';
    }
    function inizializza(vista?: { center: google.maps.LatLngLiteral | undefined; zoom: number | undefined; heading: number | undefined; tilt: number | undefined }) {
        mappa = new api.maps.Map(contenitore, {
            mapId, center: vista?.center ?? { lat: 42.5, lng: 12.5 }, zoom: vista?.zoom ?? 5,
            heading: vista?.heading, tilt: vista?.tilt,
            mapTypeId: tipo(modo), colorScheme: modo === 'scura' ? api.core.ColorScheme.DARK : api.core.ColorScheme.LIGHT,
            mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
            keyboardShortcuts: true, gestureHandling: 'cooperative',
        });
        timer = setTimeout(() => { if (!distrutta) suErrore('maps.timeout'); }, TIMEOUT_MAPPA);
        listenerTile = mappa.addListener('tilesloaded', () => {
            clearTimeout(timer);
            if (!distrutta) suPronto();
        });
        const bounds = new api.core.LatLngBounds();
        for (const evento of eventi) {
            if (!evento.coordinate) continue;
            // Un nodo distinto per evento: AdvancedMarkerElement sposta il DOM,
            // quindi non va condiviso neppure quando l'artista è lo stesso.
            const contenuto = contenutoMarker(evento);
            const marker = new api.marker.AdvancedMarkerElement({
                map: mappa, position: evento.coordinate, title: evento.titolo, gmpClickable: true,
            });
            marker.append(contenuto);
            const click = () => { if (!distrutta) suSelezione(evento.id); };
            marker.addEventListener('gmp-click', click);
            markers.push({ evento, marker, contenuto, click });
            bounds.extend(evento.coordinate);
        }
        if (!vista && markers.length === 1) {
            mappa.setCenter(markers[0]!.evento.coordinate!);
            mappa.setZoom(13);
        } else if (!vista && markers.length > 1) {
            mappa.fitBounds(bounds, 48);
        }
        evidenzia();
        if (!vista && scelta !== null) {
            const e = eventi.find((e) => e.id === scelta);
            if (e?.coordinate) mappa.panTo(e.coordinate);
        }
    }
    try { inizializza(); } catch (errore) { rimuoviMappa(); throw errore; }
    return {
        modalita(nuova: ModalitaMappa) {
            if (distrutta || nuova === modo) return;
            const ricrea = (modo === 'scura') !== (nuova === 'scura');
            modo = nuova;
            try {
                if (ricrea) {
                    const vista = { center: mappa.getCenter()?.toJSON(), zoom: mappa.getZoom(), heading: mappa.getHeading(), tilt: mappa.getTilt() };
                    rimuoviMappa();
                    inizializza(vista);
                } else { mappa.setMapTypeId(tipo(modo)); }
            } catch { suErrore('maps.modeError'); }
        },
        seleziona(id: number | null) {
            if (distrutta || id === scelta) return;
            scelta = id;
            evidenzia();
            const evento = eventi.find((e) => e.id === id);
            if (evento?.coordinate) mappa.panTo(evento.coordinate);
        },
        aggiornaTesti: evidenzia,
        distruggi() { distrutta = true; rimuoviMappa(); },
    };
}
