import { ErroreApi, impostaCsrf, richiesta } from './client';
import type {
    DatiRegistrazione,
    RispostaRegistrazione,
    RispostaSessione,
    Ruolo,
    Utente,
} from './tipi';

// Gli endpoint usati sono SOLO questi (backend reale, README della radice):
//   POST /api/auth/web/login       -> 200 { utente, csrf } + Set-Cookie
//   GET  /api/auth/io              -> 200 { utente, csrf } con il cookie, 401 senza
//   POST /api/auth/logout          -> 204 (+ Set-Cookie che cancella il cookie)
//   POST /api/auth/logout-tutti    -> 204 (+ Set-Cookie che cancella il cookie)
//   POST /api/auth/registrazione   -> 201 { utente }, non apre nessuna sessione

function eOggetto(valore: unknown): valore is Record<string, unknown> {
    return typeof valore === 'object' && valore !== null && !Array.isArray(valore);
}

function eRuolo(valore: unknown): valore is Ruolo {
    return valore === 'USER' || valore === 'ADMIN';
}

function comeUtente(valore: unknown): Utente | null {
    if (
        eOggetto(valore) &&
        typeof valore.id === 'number' &&
        typeof valore.nome === 'string' &&
        typeof valore.email === 'string' &&
        eRuolo(valore.ruolo)
    ) {
        return { id: valore.id, nome: valore.nome, email: valore.email, ruolo: valore.ruolo };
    }

    return null;
}

// Una risposta 200 con una forma diversa da quella documentata è un errore, non
// qualcosa da indovinare: stato 200 ma senza messaggio dal server.
function rispostaInattesa(): ErroreApi {
    return new ErroreApi(200, { messaggioServer: null });
}

function comeSessione(dati: unknown): RispostaSessione {
    const utente = eOggetto(dati) ? comeUtente(dati.utente) : null;

    if (utente === null || !eOggetto(dati) || typeof dati.csrf !== 'string' || dati.csrf === '') {
        throw rispostaInattesa();
    }

    return { utente, csrf: dati.csrf };
}

export async function accedi(email: string, password: string): Promise<RispostaSessione> {
    const dati = await richiesta('/auth/web/login', {
        metodo: 'POST',
        corpo: { email, password },
        conCsrf: false,
    });
    const sessione = comeSessione(dati);

    impostaCsrf(sessione.csrf);
    return sessione;
}

export async function recuperaSessione(): Promise<RispostaSessione> {
    try {
        const sessione = comeSessione(await richiesta('/auth/io'));

        impostaCsrf(sessione.csrf);
        return sessione;
    } catch (errore) {
        // Nessuna sessione valida: il token CSRF di prima non vale più.
        if (errore instanceof ErroreApi && errore.stato === 401) {
            impostaCsrf(null);
        }
        throw errore;
    }
}

// Con successo (204) o con 401 (la sessione non c'è più) il token CSRF in memoria
// non serve più; con altri errori resta, perché la sessione potrebbe esistere ancora.
async function chiudiSessione(percorso: string): Promise<void> {
    try {
        await richiesta(percorso, { metodo: 'POST' });
        impostaCsrf(null);
    } catch (errore) {
        if (errore instanceof ErroreApi && errore.stato === 401) {
            impostaCsrf(null);
        }
        throw errore;
    }
}

export function esci(): Promise<void> {
    return chiudiSessione('/auth/logout');
}

export function esciDaTutti(): Promise<void> {
    return chiudiSessione('/auth/logout-tutti');
}

export async function registrati(dati: DatiRegistrazione): Promise<RispostaRegistrazione> {
    const risposta = await richiesta('/auth/registrazione', {
        metodo: 'POST',
        corpo: dati,
        conCsrf: false,
    });
    const utente = eOggetto(risposta) ? comeUtente(risposta.utente) : null;

    if (utente === null) {
        throw rispostaInattesa();
    }

    return { utente };
}

export async function cambiaEmail(dati: { passwordCorrente: string; nuovaEmail: string; confermaEmail: string }): Promise<Utente> {
    const risposta = await richiesta('/auth/email', { metodo: 'PATCH', corpo: dati });
    const utente = eOggetto(risposta) ? comeUtente(risposta.utente) : null;
    if (!utente) throw rispostaInattesa();
    return utente;
}
export async function cambiaPassword(dati: { passwordCorrente: string; nuovaPassword: string; confermaPassword: string }): Promise<void> {
    await richiesta('/auth/password', { metodo: 'PATCH', corpo: dati });
}
