import { ErroreApi, richiesta } from './client';
import type { ArtistaSintetico } from './catalogo';

export type FiltroEventi = 'tutti' | 'seguiti';
export interface Evento {
    id: number;
    titolo: string;
    dataEvento: string;
    oraEvento: string | null;
    luogo: string | null;
    citta: string | null;
    coordinate: { lat: number; lng: number } | null;
    lineup: ArtistaSintetico[];
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
    };
}
export async function elencaEventi(filtro: FiltroEventi = 'tutti'): Promise<Evento[]> {
    if (filtro !== 'tutti' && filtro !== 'seguiti') throw new ErroreApi(400);
    const dati = await richiesta(`/eventi?filtro=${filtro}`);
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
