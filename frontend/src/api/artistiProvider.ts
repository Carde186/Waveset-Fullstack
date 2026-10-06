import { ErroreApi, richiesta } from './client';

export type Provider = 'deezer';
export interface AttractionTicketmaster { id: string; name: string; url: string | null; spotify: string | null; genere: string | null }
export interface PresenzaTicketmaster {
    stato: 'trovato' | 'non_trovato' | 'non_verificato';
    attractions: AttractionTicketmaster[];
    attractionConfermata: string | null;
    ambiguo: boolean;
    controllatoAt: string | null;
}
export interface ProfiloProvider {
    provider: Provider; externalId: string; name: string; url: string; fan: number | null;
    artwork: { url: string; width: number | null; height: number | null } | null;
    genres: string[]; storefront: string; syncedAt: string;
}
export interface LinkProvider extends ProfiloProvider { versione: number; ticketmaster: PresenzaTicketmaster }
export interface GestioneArtistaProvider {
    provider: Provider; artista: { id: number; nome: string }; collegamento: LinkProvider | null;
}
export interface ArtistaGestione {
    id: number; nome: string; providerCollegato: Provider | null;
}
export const nomeProvider = (p: Provider) => ({ deezer: 'Deezer' })[p];
function oggetto(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErroreApi(200);
    return v as Record<string, unknown>;
}
function testo(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) throw new ErroreApi(200);
    return v;
}
function provider(v: unknown): Provider {
    if (v !== 'deezer') throw new ErroreApi(200);
    return v;
}
function url(v: unknown, domini: string[]): string {
    try {
        const u = new URL(testo(v));
        if (u.protocol === 'https:' && !u.username && !u.password && domini.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`))) return u.href;
    } catch { /* Non renderizzare URL arbitrari. */ }
    throw new ErroreApi(200);
}
function profilo(v: unknown): ProfiloProvider {
    const r = oggetto(v), p = provider(r.provider), externalId = testo(r.externalId), syncedAt = testo(r.syncedAt);
    if (!/^[1-9]\d{0,29}$/.test(externalId) || typeof r.storefront !== 'string' ||
        r.storefront !== '' ||
        !Number.isFinite(Date.parse(syncedAt)) || !Array.isArray(r.genres) || r.genres.some(g => typeof g !== 'string') ||
        (r.fan !== null && (!Number.isSafeInteger(r.fan) || Number(r.fan) < 0))) throw new ErroreApi(200);
    const a = r.artwork === null ? null : oggetto(r.artwork);
    return { provider: p, externalId, name: testo(r.name), url: url(r.url, ['deezer.com']),
        fan: r.fan as number | null, artwork: a ? { url: url(a.url, ['dzcdn.net', 'deezer.com']),
            width: typeof a.width === 'number' ? a.width : null, height: typeof a.height === 'number' ? a.height : null } : null,
        genres: r.genres as string[], storefront: r.storefront, syncedAt };
}
function collegamento(v: unknown): LinkProvider {
    const r = oggetto(v), tm = oggetto(r.ticketmaster);
    if (!Number.isInteger(r.versione) || Number(r.versione) < 1 || !['trovato', 'non_trovato', 'non_verificato'].includes(String(tm.stato)) ||
        typeof tm.ambiguo !== 'boolean' || !Array.isArray(tm.attractions) ||
        (tm.controllatoAt !== null && (typeof tm.controllatoAt !== 'string' || !Number.isFinite(Date.parse(tm.controllatoAt))))) throw new ErroreApi(200);
    const idAttraction = (v: unknown) => {
        const id = testo(v); if (!/^[\w-]{1,64}$/.test(id)) throw new ErroreApi(200); return id;
    };
    const linkAttraction = (v: unknown, domini: string[]) => {
        if (v === undefined || v === null) return null;
        const link = url(v, domini), u = new URL(link);
        if (u.search || u.hash) throw new ErroreApi(200);
        return link;
    };
    const attractions = tm.attractions.map(a => {
        const d = oggetto(a);
        return { id: idAttraction(d.id), name: testo(d.name), genere: d.genere == null ? null : testo(d.genere),
            url: linkAttraction(d.url, ['ticketmaster.com','ticketmaster.ca','ticketmaster.co.uk','ticketmaster.com.au',
                'ticketmaster.co.nz','ticketmaster.de','ticketmaster.fr','ticketmaster.it','ticketmaster.es','ticketmaster.nl']),
            spotify: linkAttraction(d.spotify, ['open.spotify.com']) };
    });
    if ((tm.stato === 'trovato') !== (attractions.length > 0) || tm.ambiguo !== (attractions.length > 1)) throw new ErroreApi(200);
    return { ...profilo(r), versione: r.versione as number, ticketmaster: { stato: tm.stato as PresenzaTicketmaster['stato'], attractions,
        ambiguo: tm.ambiguo, controllatoAt: tm.controllatoAt as string | null,
        attractionConfermata: tm.attractionConfermata == null ? null : idAttraction(tm.attractionConfermata) } };
}
function percorso(id: number, p?: Provider): string {
    if (!Number.isInteger(id) || id <= 0 || id > 2147483647) throw new ErroreApi(400);
    return `/admin/artisti/${id}/${p ? 'deezer' : 'provider'}`;
}
export async function leggiProvider(): Promise<Provider> {
    return provider(oggetto(await richiesta('/admin/artisti/provider')).provider);
}
export async function elencaGestioneArtisti(): Promise<ArtistaGestione[]> {
    const risposta = await richiesta('/admin/artisti');
    if (!Array.isArray(risposta)) throw new ErroreApi(200);
    return risposta.map(v => {
        const a = oggetto(v);
        if (!Number.isSafeInteger(a.id) || Number(a.id) <= 0) throw new ErroreApi(200);
        return { id: a.id as number, nome: testo(a.nome),
            providerCollegato: a.provider_collegato === null ? null : provider(a.provider_collegato) };
    });
}
export async function leggiGestioneProvider(id: number): Promise<GestioneArtistaProvider> {
    const r = oggetto(await richiesta(percorso(id))), a = oggetto(r.artista), p = provider(r.provider);
    if (a.id !== id) throw new ErroreApi(200);
    const link = r.collegamento === null ? null : collegamento(r.collegamento);
    if (link && link.provider !== p) throw new ErroreApi(200);
    return { provider: p, artista: { id, nome: testo(a.nome) }, collegamento: link };
}
export async function cercaProvider(id: number, p: Provider, q: string): Promise<ProfiloProvider[]> {
    const r = oggetto(await richiesta(`${percorso(id, p)}/search?${new URLSearchParams({ q })}`));
    if (!Array.isArray(r.risultati)) throw new ErroreApi(200);
    const risultati = r.risultati.map(profilo);
    if (risultati.some(v => v.provider !== p) || new Set(risultati.map(v => v.externalId)).size !== risultati.length) throw new ErroreApi(200);
    return risultati;
}
export async function collegaProvider(id: number, p: Provider, externalId: string, versione: number | null): Promise<LinkProvider> {
    return collegamento(await richiesta(`${percorso(id, p)}/collegamento`, { metodo: 'POST', corpo: { external_id: externalId, versione_attesa: versione } }));
}
export async function sincronizzaProvider(id: number, p: Provider, versione: number): Promise<LinkProvider> {
    return collegamento(await richiesta(`${percorso(id, p)}/sincronizza`, { metodo: 'POST', corpo: { versione_attesa: versione } }));
}
export async function ricontrollaTicketmaster(id: number, p: Provider, versione: number): Promise<LinkProvider> {
    return collegamento(await richiesta(`${percorso(id, p)}/ticketmaster`, { metodo: 'POST', corpo: { versione_attesa: versione } }));
}
export async function confermaTicketmaster(id: number, p: Provider, attraction: string | null, attesa: string | null, versione: number): Promise<LinkProvider> {
    return collegamento(await richiesta(`${percorso(id, p)}/ticketmaster/collegamento`, { metodo: 'POST',
        corpo: { attraction_id: attraction, attraction_attesa: attesa, versione_attesa: versione } }));
}
