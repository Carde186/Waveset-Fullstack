// Destinazioni esplicite del flusso follow, mai URL esterni o arbitrari.
export function ritornoDopoAccesso(stato: unknown): string | null {
    if (typeof stato !== 'object' || stato === null || !('ritorno' in stato) || typeof stato.ritorno !== 'string') return null;
    if (stato.ritorno === '/artisti-seguiti') return stato.ritorno;
    const id = /^\/artisti\/([1-9]\d*)$/.exec(stato.ritorno)?.[1];
    return id && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647 ? stato.ritorno : null;
}
