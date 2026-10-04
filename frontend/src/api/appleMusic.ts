import { ErroreApi, richiesta } from './client';

export interface ProfiloApple {
    externalId: string;
    name: string;
    url: string;
    artwork: { url: string; width: number | null; height: number | null } | null;
    genres: string[];
    storefront: string;
    syncedAt: string;
}
export interface LinkApple extends ProfiloApple { versione: number }
export interface GestioneArtistaApple {
    artista: { id: number; nome: string };
    collegamento: LinkApple | null;
}
function oggetto(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErroreApi(200);
    return v as Record<string, unknown>;
}
function testo(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) throw new ErroreApi(200);
    return v;
}
function url(v: unknown, dominio: string): string {
    try {
        const u = new URL(testo(v));
        if (u.protocol === 'https:' && !u.username && !u.password &&
            (u.hostname === dominio || u.hostname.endsWith(`.${dominio}`))) return u.href;
    } catch { /* Risposta inattesa, non renderizzare URL arbitrari. */ }
    throw new ErroreApi(200);
}
function profilo(v: unknown): ProfiloApple {
    const r = oggetto(v);
    const externalId = testo(r.externalId), storefront = testo(r.storefront), syncedAt = testo(r.syncedAt);
    if (!/^[1-9]\d{0,29}$/.test(externalId) || !/^[a-z]{2}$/.test(storefront) || !Number.isFinite(Date.parse(syncedAt)) || !Array.isArray(r.genres) || r.genres.some(g => typeof g !== 'string')) throw new ErroreApi(200);
    const arte = r.artwork === null ? null : oggetto(r.artwork);
    return { externalId, name: testo(r.name), storefront, syncedAt, genres: r.genres as string[],
        url: url(r.url, 'music.apple.com'), artwork: arte === null ? null : {
            url: url(arte.url, 'mzstatic.com'), width: typeof arte.width === 'number' ? arte.width : null,
            height: typeof arte.height === 'number' ? arte.height : null,
        } };
}
function collegamento(v: unknown): LinkApple {
    const r = oggetto(v);
    if (!Number.isInteger(r.versione) || Number(r.versione) < 1) throw new ErroreApi(200);
    return { ...profilo(r), versione: r.versione as number };
}
function percorso(id: number): string {
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErroreApi(400);
    return `/admin/artisti/${id}/apple-music`;
}
export async function leggiGestioneApple(id: number): Promise<GestioneArtistaApple> {
    const r = oggetto(await richiesta(percorso(id)));
    const artista = oggetto(r.artista);
    if (artista.id !== id) throw new ErroreApi(200);
    return { artista: { id, nome: testo(artista.nome) }, collegamento: r.collegamento === null ? null : collegamento(r.collegamento) };
}
export async function cercaApple(id: number, q: string): Promise<ProfiloApple[]> {
    const r = oggetto(await richiesta(`${percorso(id)}/search?${new URLSearchParams({ q })}`));
    if (!Array.isArray(r.risultati)) throw new ErroreApi(200);
    const risultati = r.risultati.map(profilo);
    if (new Set(risultati.map(r => r.externalId)).size !== risultati.length) throw new ErroreApi(200);
    return risultati;
}
export async function collegaApple(id: number, externalId: string, versione: number | null): Promise<LinkApple> {
    return collegamento(await richiesta(`${percorso(id)}/collegamento`, { metodo: 'POST', corpo: { external_id: externalId, versione_attesa: versione } }));
}
export async function sincronizzaApple(id: number, versione: number): Promise<LinkApple> {
    return collegamento(await richiesta(`${percorso(id)}/sincronizza`, { metodo: 'POST', corpo: { versione_attesa: versione } }));
}
