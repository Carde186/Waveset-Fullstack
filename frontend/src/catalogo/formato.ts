import { ErroreApi } from '../api/client';
import { messaggioGenerico } from '../api/messaggi';

export function erroreCatalogo(causa: unknown): string {
    return causa instanceof ErroreApi && causa.stato === 200
        ? 'I dati ricevuti non sono leggibili. Riprova.'
        : messaggioGenerico(causa);
}

export function dataCatalogo(data: string | null): string {
    if (data === null) return 'Data non disponibile';
    return new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(`${data}T00:00:00Z`),
    );
}
