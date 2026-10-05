// Il genere è un ID del catalogo: la lingua non cambia filtri o URL.
import type { FiltroEventi } from '../api/eventi';

export function leggiFiltroEventi(parametri: URLSearchParams): { valido: boolean; genereId?: number; filtro: FiltroEventi } {
    const filtro = parametri.get('filtro');
    const genere = parametri.get('genere_id');
    const numero = genere === null ? undefined : Number(genere);
    return {
        valido: parametri.getAll('filtro').length <= 1 &&
            (filtro === null || filtro === 'tutti' || filtro === 'seguiti') &&
            parametri.getAll('genere_id').length <= 1 &&
            (genere === null || (/^[1-9]\d*$/.test(genere) && Number.isSafeInteger(numero) && numero! <= 2147483647)),
        genereId: numero,
        filtro: filtro === 'seguiti' ? 'seguiti' : 'tutti',
    };
}
export function queryEventi(genereId?: number, filtro: FiltroEventi = 'tutti'): string {
    const parametri = new URLSearchParams({ filtro });
    if (genereId !== undefined) parametri.set('genere_id', String(genereId));
    return `?${parametri}`;
}
export function ritornoEventi(parametri: URLSearchParams): string {
    const { valido, genereId, filtro } = leggiFiltroEventi(parametri);
    return valido && (parametri.has('filtro') || genereId !== undefined) ? `/eventi${queryEventi(genereId, filtro)}` : '/eventi';
}
