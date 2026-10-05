import { ErroreApi, richiesta } from './client';
export interface PubblicazioneDeezer {
    externalId: string; titolo: string; copertinaUrl: string | null; urlDeezer: string;
    dataPubblicazione?: string | null; tipo?: 'album' | 'single' | 'ep'; artista?: string | null;
}
export interface Discografia {
    disponibile: boolean; externalId?: string; brani: PubblicazioneDeezer[];
    pubblicazioni: PubblicazioneDeezer[]; prossimoIndice: number | null;
}
function pubblicazione(v: unknown): PubblicazioneDeezer {
    const r = v as PubblicazioneDeezer;
    if (!r || typeof r.externalId !== 'string' || !/^\d+$/.test(r.externalId) || typeof r.titolo !== 'string') throw new ErroreApi(200);
    const url = new URL(r.urlDeezer);
    if (url.protocol !== 'https:' || !['www.deezer.com', 'deezer.com'].includes(url.hostname) || url.username || url.password) throw new ErroreApi(200);
    let cover: string | null = null;
    try {
        const u = new URL(r.copertinaUrl ?? '');
        if (u.protocol === 'https:' && u.hostname.endsWith('.dzcdn.net') && u.pathname.includes('/images/cover/') && !u.username && !u.password) cover = u.href;
    } catch { /* Copertina mancante: segnaposto della pubblicazione. */ }
    return { ...r, copertinaUrl: cover };
}
export async function leggiDiscografia(id: number, indice = 0): Promise<Discografia> {
    const r = await richiesta(`/artisti/${id}/discografia?indice=${indice}`) as Discografia;
    if (!r || typeof r.disponibile !== 'boolean' || !Array.isArray(r.brani) || !Array.isArray(r.pubblicazioni) ||
        !(r.prossimoIndice === null || Number.isSafeInteger(r.prossimoIndice) && r.prossimoIndice > indice)) throw new ErroreApi(200);
    return { ...r, brani: r.brani.map(pubblicazione), pubblicazioni: r.pubblicazioni.map(pubblicazione) };
}
export interface CopertinaVetrina { id: string; titolo: string; tipo: 'album' | 'evento'; url: string }
export async function leggiCopertine(): Promise<CopertinaVetrina[]> {
    const r = await richiesta('/catalogo/copertine');
    if (!Array.isArray(r)) throw new ErroreApi(200);
    return r.filter((v): v is CopertinaVetrina => {
        if (!v || typeof v.titolo !== 'string' || typeof v.id !== 'string' || !['album', 'evento'].includes(v.tipo)) return false;
        try {
            const u = new URL(v.url);
            return u.protocol === 'https:' && !u.username && !u.password &&
                ['ticketm.net', 'ticketmaster.com', 'livenation.com', 'dzcdn.net', 'mzstatic.com'].some(h => u.hostname === h || u.hostname.endsWith(`.${h}`)) && !u.pathname.includes('/images/artist/');
        } catch { return false; }
    });
}
