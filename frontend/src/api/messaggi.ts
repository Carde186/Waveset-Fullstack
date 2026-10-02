import { ErroreApi } from './client';

// Testi mostrati all'utente per gli errori dell'API. Vivono qui, in un solo posto,
// così le schermate non cambiano se cambia una frase.

export const TESTO_SESSIONE_NON_DISPONIBILE =
    'La sessione del browser non è attiva su questo server: il backend deve essere avviato con ' +
    "FRONTEND_ORIGINS impostata sull'origine di questa pagina (vedi frontend/README.md).";

const MESSAGGIO_SERVER_503 = 'Sessione browser non disponibile';

function conRiprova(base: string, errore: ErroreApi): string {
    return errore.riprovaTraSec === null
        ? `${base} Riprova tra qualche minuto.`
        : `${base} Riprova tra ${errore.riprovaTraSec} secondi.`;
}

// Errori comuni a ogni schermata. Restituisce null se non è un caso generale.
function messaggioComune(errore: unknown): string | null {
    if (!(errore instanceof ErroreApi)) {
        return 'Qualcosa è andato storto. Riprova.';
    }
    if (errore.eRete) {
        return 'Il server non risponde. Controlla che il backend sia avviato e riprova.';
    }
    if (errore.stato === 429) {
        return conRiprova('Troppi tentativi.', errore);
    }
    if (errore.stato >= 500) {
        return errore.stato === 503 && errore.messaggioServer === MESSAGGIO_SERVER_503
            ? TESTO_SESSIONE_NON_DISPONIBILE
            : `Il backend non è raggiungibile o ha risposto con un errore (codice ${errore.stato}).`;
    }

    return null;
}

export function messaggioGenerico(errore: unknown): string {
    return (
        messaggioComune(errore) ??
        `Richiesta non riuscita (codice ${errore instanceof ErroreApi ? errore.stato : '?'}).`
    );
}

export function messaggioAccesso(errore: unknown): string {
    const comune = messaggioComune(errore);

    if (comune !== null) {
        return comune;
    }
    if (errore instanceof ErroreApi) {
        if (errore.stato === 401) {
            return 'Email o password errati.';
        }
        if (errore.stato === 400) {
            return 'Inserisci email e password.';
        }
        if (errore.stato === 403) {
            return (
                "Il server ha rifiutato la richiesta: l'origine di questa pagina non è tra " +
                "quelle ammesse. Apri l'app dall'indirizzo previsto (vedi frontend/README.md)."
            );
        }
    }

    return messaggioGenerico(errore);
}

export function messaggioRegistrazione(errore: unknown): string {
    const comune = messaggioComune(errore);

    if (comune !== null) {
        return comune;
    }
    if (errore instanceof ErroreApi) {
        if (errore.stato === 403) {
            return (
                'Il browser ha ancora una sessione non più valida e il server rifiuta la ' +
                'registrazione. Accedi (anche con un altro account) e riprova.'
            );
        }
        if (errore.stato === 400) {
            return 'Controlla i dati inseriti.';
        }
    }

    return messaggioGenerico(errore);
}

export function messaggioUscita(errore: unknown): string {
    if (errore instanceof ErroreApi && errore.stato === 403) {
        return 'Il server ha rifiutato la richiesta di uscita. Ricarica la pagina e riprova.';
    }

    return messaggioGenerico(errore);
}
