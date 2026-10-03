import motiviServer from '../localizzazione/errori-server.json';
import { ErroreApi } from './client';
import { t, type Chiave } from '../localizzazione/lingua';

// Si conserva la chiave nello stato: un errore già visibile cambia lingua
// senza ripetere la richiesta né conservare messaggi interni del server.
export interface Messaggio { chiave: Chiave; parametri?: Record<string, string | number> }
export function testoMessaggio(messaggio: Messaggio): string {
    return t(messaggio.chiave, messaggio.parametri);
}
function messaggioComune(errore: unknown): Messaggio | null {
    if (!(errore instanceof ErroreApi)) return { chiave: 'error.generic' };
    if (errore.eRete) return { chiave: 'error.network' };
    if (errore.stato === 429) return errore.riprovaTraSec === null
        ? { chiave: 'error.rate' } : { chiave: 'error.rateSeconds', parametri: { seconds: errore.riprovaTraSec } };
    if (errore.stato >= 500) return errore.stato === 503 && (motiviServer as Record<string, Chiave>)[errore.messaggioServer ?? ''] === 'error.sessionUnavailable'
        ? { chiave: 'error.sessionUnavailable' } : { chiave: 'error.server', parametri: { status: errore.stato } };
    return null;
}
export function messaggioGenerico(errore: unknown): Messaggio {
    return messaggioComune(errore) ?? { chiave: 'error.request', parametri: { status: errore instanceof ErroreApi ? errore.stato : '?' } };
}
export function messaggioAccesso(errore: unknown): Messaggio {
    const comune = messaggioComune(errore);
    if (comune) return comune;
    if (errore instanceof ErroreApi) {
        if (errore.stato === 401) return { chiave: 'error.credentials' };
        if (errore.stato === 400) return { chiave: 'error.loginRequired' };
        if (errore.stato === 403) return { chiave: 'error.origin' };
    }
    return messaggioGenerico(errore);
}
export function messaggioRegistrazione(errore: unknown): Messaggio {
    if (errore instanceof ErroreApi && errore.stato === 403) return { chiave: 'error.registrationSession' };
    if (errore instanceof ErroreApi && errore.stato === 400) return { chiave: 'common.invalidData' };
    return messaggioGenerico(errore);
}
export function messaggioUscita(errore: unknown): Messaggio {
    return errore instanceof ErroreApi && errore.stato === 403 ? { chiave: 'error.logout' } : messaggioGenerico(errore);
}
