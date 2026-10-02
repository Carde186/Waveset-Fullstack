import { ErroreApi, richiesta } from './client';

export const MINIMO_RICERCA = 2;
export const MASSIMO_RICERCA = 100;

export interface Genere {
    id: number;
    nome: string;
}
export interface ArtistaSintetico extends Genere {
    immagineUrl: string | null;
}
export interface BranoElenco {
    id: number;
    titolo: string;
    dataPubblicazione: string | null;
    urlSpotify: string | null;
}
export interface AlbumSintetico {
    id: number;
    titolo: string;
    copertinaUrl: string | null;
}
export interface Brano extends BranoElenco {
    collaboratori: string | null;
    artista: ArtistaSintetico;
    album: AlbumSintetico | null;
}
export interface Album extends AlbumSintetico {
    dataPubblicazione: string | null;
    artista: ArtistaSintetico;
    brani: BranoElenco[];
}
export interface CreditoImmagine {
    autore: string;
    licenza: string | null;
    fonteUrl: string | null;
    modificata: boolean;
}
export interface Artista extends ArtistaSintetico {
    bio: string | null;
    creditoImmagine: CreditoImmagine | null;
    generi: Genere[];
    brani: (BranoElenco & { albumId: number | null })[];
    album: (AlbumSintetico & { dataPubblicazione: string | null })[];
    eventi: {
        id: number;
        titolo: string;
        dataEvento: string | null;
        oraEvento: string | null;
        luogo: string | null;
        citta: string | null;
    }[];
    seguito: boolean;
}
export interface RisultatiRicerca {
    artisti: ArtistaSintetico[];
    brani: Brano[];
}

// Unico confine di normalizzazione: le pagine non interpretano nomi SQL.
function inattesa(): never {
    throw new ErroreApi(200);
}
function oggetto(v: unknown): Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return inattesa();
    return v as Record<string, unknown>;
}
function lista<T>(v: unknown, leggi: (elemento: unknown) => T): T[] {
    if (!Array.isArray(v)) return inattesa();
    return v.map(leggi);
}
function id(v: unknown): number {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) return inattesa();
    return v;
}
function testo(v: unknown): string {
    if (typeof v !== 'string') return inattesa();
    return v;
}
function nullable(v: unknown): string | null {
    return v === null ? null : testo(v);
}
function booleano(v: unknown): boolean {
    if (typeof v !== 'boolean') return inattesa();
    return v;
}
function data(v: unknown): string | null {
    if (v === null) return null;
    const s = testo(v);
    // DATE arriva come stringa o come Date serializzata da Express/mysql2.
    // Si conserva il giorno espresso nel JSON, senza conversioni al fuso del browser.
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(s)) return inattesa();
    if (s.includes('T') && !Number.isFinite(Date.parse(s))) return inattesa();
    const giorno = s.slice(0, 10);
    const d = new Date(`${giorno}T00:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== giorno) return inattesa();
    return giorno;
}
function https(v: unknown, dominio?: string): string | null {
    const s = nullable(v);
    if (s === null) return null;
    try {
        const u = new URL(s);
        if (
            u.protocol !== 'https:' ||
            u.username ||
            u.password ||
            (dominio && u.hostname !== dominio)
        )
            return null;
        return u.href;
    } catch {
        return null;
    }
}
function immagine(v: unknown): string | null {
    const s = https(v);
    if (s === null) return null;
    const host = new URL(s).hostname;
    return host === 'picsum.photos' || host.endsWith('.picsum.photos') ? null : s;
}
function genere(v: unknown): Genere {
    const r = oggetto(v);
    return { id: id(r.id), nome: testo(r.nome) };
}
function artistaElenco(v: unknown): ArtistaSintetico {
    const r = oggetto(v);
    return { ...genere(r), immagineUrl: immagine(r.immagine_url) };
}
function artistaAnnidato(v: unknown): ArtistaSintetico {
    const r = oggetto(v);
    return { ...genere(r), immagineUrl: immagine(r.immagineUrl) };
}
function branoSql(v: unknown): BranoElenco {
    const r = oggetto(v);
    return {
        id: id(r.id),
        titolo: testo(r.titolo),
        dataPubblicazione: data(r.data_pubblicazione),
        urlSpotify: https(r.url_spotify, 'open.spotify.com'),
    };
}
function albumAnnidato(v: unknown): AlbumSintetico {
    const r = oggetto(v);
    return { id: id(r.id), titolo: testo(r.titolo), copertinaUrl: immagine(r.copertinaUrl) };
}
function brano(v: unknown): Brano {
    const r = oggetto(v);
    return {
        id: id(r.id),
        titolo: testo(r.titolo),
        dataPubblicazione: data(r.dataPubblicazione),
        urlSpotify: https(r.urlSpotify, 'open.spotify.com'),
        collaboratori: nullable(r.collaboratori),
        artista: artistaAnnidato(r.artista),
        album: r.album === null ? null : albumAnnidato(r.album),
    };
}
function artista(v: unknown): Artista {
    const r = oggetto(v);
    const credito = r.credito_immagine === null ? null : oggetto(r.credito_immagine);
    return {
        ...artistaElenco(r),
        bio: nullable(r.bio),
        seguito: booleano(r.seguito),
        creditoImmagine:
            credito === null
                ? null
                : {
                      autore: testo(credito.autore),
                      licenza: nullable(credito.licenza),
                      fonteUrl: https(credito.fonte_url),
                      modificata: booleano(credito.modificata),
                  },
        generi: lista(r.generi, genere),
        brani: lista(r.brani, (v) => {
            const b = oggetto(v);
            return { ...branoSql(b), albumId: b.album_id === null ? null : id(b.album_id) };
        }),
        album: lista(r.album, (v) => {
            const a = oggetto(v);
            return {
                id: id(a.id),
                titolo: testo(a.titolo),
                dataPubblicazione: data(a.data_pubblicazione),
                copertinaUrl: immagine(a.copertina_url),
            };
        }),
        eventi: lista(r.eventi, (v) => {
            const e = oggetto(v);
            return {
                id: id(e.id),
                titolo: testo(e.titolo),
                dataEvento: data(e.data_evento),
                oraEvento: nullable(e.ora_evento),
                luogo: nullable(e.luogo),
                citta: nullable(e.citta),
            };
        }),
    };
}
function album(v: unknown): Album {
    const r = oggetto(v);
    return {
        ...albumAnnidato(r),
        dataPubblicazione: data(r.dataPubblicazione),
        artista: artistaAnnidato(r.artista),
        brani: lista(r.brani, branoSql),
    };
}

export function idDaPercorso(v: string | undefined): number | null {
    if (!v || !/^[1-9]\d*$/.test(v)) return null;
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
}
function verificaId(n: number): void {
    if (!Number.isSafeInteger(n) || n <= 0) throw new ErroreApi(404);
}
async function dettaglio<T extends { id: number }>(
    percorso: string,
    n: number,
    leggi: (v: unknown) => T,
): Promise<T> {
    verificaId(n);
    const risultato = leggi(await richiesta(`${percorso}/${n}`));
    if (risultato.id !== n) return inattesa();
    return risultato;
}
export async function elencaGeneri(): Promise<Genere[]> {
    return lista(await richiesta('/generi'), genere);
}
export async function elencaArtisti(genereId?: number): Promise<ArtistaSintetico[]> {
    if (genereId !== undefined) verificaId(genereId);
    return lista(
        await richiesta(genereId === undefined ? '/artisti' : `/artisti?genere_id=${genereId}`),
        artistaElenco,
    );
}
export async function cercaCatalogo(query: string): Promise<RisultatiRicerca> {
    const q = query.trim();
    if (q.length > MASSIMO_RICERCA) throw new ErroreApi(400);
    if (q.length < MINIMO_RICERCA) return { artisti: [], brani: [] };
    const r = oggetto(await richiesta(`/ricerca?${new URLSearchParams({ q })}`));
    return { artisti: lista(r.artisti, artistaElenco), brani: lista(r.brani, brano) };
}
export const leggiArtista = (n: number) => dettaglio('/artisti', n, artista);
export const leggiBrano = (n: number) => dettaglio('/brani', n, brano);
export const leggiAlbum = (n: number) => dettaglio('/album', n, album);

// Mappature locali esistenti: nessuna ricerca esterna o copertina iTunes live.
async function link(
    n: number,
    percorso: string,
    campo: string,
    dominio: string,
): Promise<string | null> {
    verificaId(n);
    try {
        const r = oggetto(await richiesta(percorso));
        const u = https(r[campo], dominio);
        if (u === null) return inattesa();
        return u;
    } catch (e) {
        if (e instanceof ErroreApi && e.stato === 404) return null;
        throw e;
    }
}
export const leggiLinkApple = (n: number) =>
    link(n, `/brani/${n}/link-apple`, 'link_traccia', 'music.apple.com');
export const leggiLinkSpotify = (n: number) =>
    link(n, `/album/${n}/link-spotify`, 'link_store', 'open.spotify.com');
