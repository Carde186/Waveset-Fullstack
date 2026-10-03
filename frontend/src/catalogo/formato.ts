import { t, locale } from '../localizzazione/lingua';
import { ErroreApi } from '../api/client';
import { messaggioGenerico, testoMessaggio } from '../api/messaggi';

export function erroreCatalogo(causa: unknown): string {
    return causa instanceof ErroreApi && causa.stato === 200
        ? t('error.unreadable')
        : testoMessaggio(messaggioGenerico(causa));
}

export function dataControllo(iso: string): string {
    return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
export function dataCatalogo(data: string | null): string {
    if (data === null) return t('catalog.dateUnavailable');
    return new Intl.DateTimeFormat(locale(), { dateStyle: 'long', timeZone: 'UTC' }).format(
        new Date(`${data}T00:00:00Z`),
    );
}
