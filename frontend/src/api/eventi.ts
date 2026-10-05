import { ErroreApi, richiesta } from './client';
import type { ArtistaSintetico } from './catalogo';

export type FiltroEventi = 'tutti' | 'seguiti';
export interface ImmagineEvento {
    url: string; width: number; height: number; ratio: string | null; fallback: boolean; source: 'ticketmaster';
}
export interface Evento {
    id: number;
    titolo: string;
    dataEvento: string;
    oraEvento: string | null;
    luogo: string | null;
    citta: string | null;
    coordinate: { lat: number; lng: number } | null;
    lineup: ArtistaSintetico[];
    immagineUrl?: string | null;
    immagine?: ImmagineEvento | null;
    fonte?: { stato: string; ultimoControllo: string | null; assente: boolean; modifiche: boolean };
}

export interface StatoSincronizzazione {
    configurata: boolean; attiva: boolean; ultimo_tentativo: string | null; ultimo_successo: string | null;
    dati_vecchi: boolean; errore_temporaneo: boolean; parziale: boolean; intervallo_secondi: number;
}
export async function leggiStatoSincronizzazione(): Promise<StatoSincronizzazione> {
    const r = oggetto(await richiesta('/eventi/sincronizzazione'));
    for (const k of ['configurata', 'attiva', 'dati_vecchi', 'errore_temporaneo', 'parziale']) if (typeof r[k] !== 'boolean') return inattesa();
    for (const k of ['ultimo_tentativo', 'ultimo_successo']) if (r[k] !== null && (typeof r[k] !== 'string' || !Number.isFinite(Date.parse(r[k])))) return inattesa();
    if (typeof r.intervallo_secondi !== 'number' || !Number.isFinite(r.intervallo_secondi) || r.intervallo_secondi <= 0) return inattesa();
    return r as unknown as StatoSincronizzazione;
}

function inattesa(): never { throw new ErroreApi(200); }
function oggetto(v: unknown): Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return inattesa();
    return v as Record<string, unknown>;
}
function id(v: unknown): number {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return inattesa();
    return v;
}
export function idEventoDaPercorso(v: string | undefined): number | null {
    if (!v || !/^[1-9]\d*$/.test(v)) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
}
function testo(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) return inattesa();
    return v.trim();
}
function nullable(v: unknown): string | null {
    return v === null ? null : testo(v);
}
// Non ricaviamo il giorno tagliando un timestamp UTC: il backend deve
// fornire la DATE locale stabilizzata. Un timestamp ambiguo è un errore dati.
function giorno(v: unknown): string {
    const s = testo(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) return inattesa();
    const d = new Date(`${s}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) return inattesa();
    return s;
}
function ora(v: unknown): string | null {
    if (v === null) return null;
    const s = testo(v);
    return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s) ? s : inattesa();
}
function numero(v: unknown, limite: number): number | null {
    if (typeof v !== 'number' && (typeof v !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(v))) return null;
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= limite ? n : null;
}
function immagine(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    try {
        const u = new URL(v);
        if (u.protocol !== 'https:' || u.username || u.password || u.hostname === 'picsum.photos' || u.hostname.endsWith('.picsum.photos')) return null;
        return u.href;
    } catch { return null; }
}
export function normalizzaEvento(v: unknown): Evento {
    const r = oggetto(v);
    if (!Array.isArray(r.lineup)) return inattesa();
    const lineup = r.lineup.map((v) => {
        const a = oggetto(v);
        return { id: id(a.id), nome: testo(a.nome), immagineUrl: immagine(a.immagine_url ?? a.immagineUrl) };
    });
    if (new Set(lineup.map((a) => a.id)).size !== lineup.length) return inattesa();
    const lat = numero(r.latitudine, 90);
    const lng = numero(r.longitudine, 180);
    return {
        id: id(r.id), titolo: testo(r.titolo),
        dataEvento: giorno(r.data_evento ?? r.dataEvento),
        oraEvento: ora(r.ora_evento !== undefined ? r.ora_evento : r.oraEvento),
        luogo: nullable(r.luogo), citta: nullable(r.citta),
        coordinate: lat !== null && lng !== null ? { lat, lng } : null,
        lineup,
        immagineUrl: immagine(r.immagine_url),
        immagine: metadatiImmagine(r.immagine, immagine(r.immagine_url)),
        ...(r.fonte === 'ticketmaster' ? { fonte: {
            stato: ['onsale', 'offsale', 'canceled', 'postponed', 'rescheduled'].includes(String(r.stato_fonte)) ? String(r.stato_fonte) : 'unknown',
            ultimoControllo: typeof r.ultimo_controllo === 'string' && Number.isFinite(Date.parse(r.ultimo_controllo)) ? r.ultimo_controllo : null,
            assente: r.assente_fonte === true, modifiche: r.modifiche_fonte === true,
        } } : {}),
    };
}
function metadatiImmagine(v: unknown, url: string | null): ImmagineEvento | null {
    if (!url || !v || typeof v !== 'object' || Array.isArray(v)) return null;
    const r = v as Record<string, unknown>;
    if (r.source !== 'ticketmaster' || r.url !== url || typeof r.width !== 'number' || !Number.isInteger(r.width) || r.width < 1 ||
        typeof r.height !== 'number' || !Number.isInteger(r.height) || r.height < 1 || typeof r.fallback !== 'boolean') return null;
    return { url, width: r.width, height: r.height, ratio: typeof r.ratio === 'string' ? r.ratio : null, fallback: r.fallback, source: 'ticketmaster' };
}
export async function elencaEventi(filtro: FiltroEventi = 'tutti', genereId?: number): Promise<Evento[]> {
    if (filtro !== 'tutti' && filtro !== 'seguiti') throw new ErroreApi(400);
    if (genereId !== undefined && (!Number.isSafeInteger(genereId) || genereId <= 0 || genereId > 2147483647)) throw new ErroreApi(400);
    const parametri = new URLSearchParams({ filtro });
    if (genereId !== undefined) parametri.set('genere_id', String(genereId));
    const dati = await richiesta(`/eventi?${parametri}`);
    if (!Array.isArray(dati)) return inattesa();
    const eventi = dati.map(normalizzaEvento);
    if (new Set(eventi.map((e) => e.id)).size !== eventi.length) return inattesa();
    return eventi;
}
export async function leggiEvento(numero: number): Promise<Evento> {
    if (!Number.isSafeInteger(numero) || numero <= 0) throw new ErroreApi(400);
    const evento = normalizzaEvento(await richiesta(`/eventi/${numero}`));
    if (evento.id !== numero) return inattesa();
    return evento;
}
