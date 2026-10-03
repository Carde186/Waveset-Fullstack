// Client HTTP del frontend.
//
// - Tutte le chiamate vanno a /api sulla STESSA origine della pagina (in sviluppo il
//   proxy di Vite le inoltra al backend): niente CORS, e il browser aggiunge da solo
//   l'intestazione Origin. Il codice non imposta MAI Origin né Cookie.
// - La sessione è un cookie HttpOnly: il JavaScript non lo vede e non lo tocca. Le
//   richieste partono con `credentials: 'same-origin'` perché il browser lo alleghi.
// - Il token CSRF (lo restituiscono web/login e /auth/io) vive SOLO in memoria, in
//   questo modulo: mai in localStorage, sessionStorage, cookie leggibili o URL. Si
//   perde a ogni ricarico e si recupera con /auth/io.

export class ErroreApi extends Error {
    // 0 = nessuna risposta (rete, backend spento); altrimenti lo stato HTTP.
    readonly stato: number;
    readonly codice: string | null;
    // Il testo `messaggio` del corpo JSON del backend, se c'era.
    readonly messaggioServer: string | null;
    // Errori per campo (400 della registrazione): { campo: motivo }.
    readonly campi: Record<string, string> | null;
    // Secondi dell'intestazione Retry-After (429), se presente.
    readonly riprovaTraSec: number | null;

    constructor(
        stato: number,
        dettagli: {
            messaggioServer?: string | null;
            codice?: string | null;
            campi?: Record<string, string> | null;
            riprovaTraSec?: number | null;
        } = {},
    ) {
        super(dettagli.messaggioServer ?? `Errore ${stato}`);
        this.name = 'ErroreApi';
        this.stato = stato;
        this.codice = dettagli.codice ?? null;
        this.messaggioServer = dettagli.messaggioServer ?? null;
        this.campi = dettagli.campi ?? null;
        this.riprovaTraSec = dettagli.riprovaTraSec ?? null;
    }

    get eRete(): boolean {
        return this.stato === 0;
    }
}

let csrfInMemoria: string | null = null;

export function impostaCsrf(valore: string | null): void {
    csrfInMemoria = valore;
}

export function leggiCsrf(): string | null {
    return csrfInMemoria;
}

const METODI_SICURI = new Set(['GET', 'HEAD']);

interface OpzioniRichiesta {
    metodo?: 'GET' | 'POST' | 'PATCH';
    corpo?: unknown;
    // Le richieste non sicure portano X-CSRF-Token (se in memoria). Il login e la
    // registrazione non lo usano: prima non esiste ancora una sessione.
    conCsrf?: boolean;
}

function eOggetto(valore: unknown): valore is Record<string, unknown> {
    return typeof valore === 'object' && valore !== null && !Array.isArray(valore);
}

function estraiCampi(dati: unknown): Record<string, string> | null {
    if (!eOggetto(dati) || !eOggetto(dati.campi)) {
        return null;
    }

    const campi: Record<string, string> = {};

    for (const [nome, motivo] of Object.entries(dati.campi)) {
        if (typeof motivo === 'string') {
            campi[nome] = motivo;
        }
    }

    return Object.keys(campi).length > 0 ? campi : null;
}

function leggiRiprovaTra(risposta: Response): number | null {
    const grezzo = risposta.headers.get('Retry-After');
    const secondi = grezzo === null ? Number.NaN : Number.parseInt(grezzo, 10);

    return Number.isFinite(secondi) && secondi > 0 ? secondi : null;
}

// Restituisce il corpo JSON (unknown: chi chiama ne verifica la forma), oppure
// undefined per un 204. Lancia ErroreApi per rete assente o stato non 2xx.
export async function richiesta(
    percorso: string,
    { metodo = 'GET', corpo, conCsrf = true }: OpzioniRichiesta = {},
): Promise<unknown> {
    const intestazioni: Record<string, string> = { Accept: 'application/json' };

    if (corpo !== undefined) {
        intestazioni['Content-Type'] = 'application/json';
    }
    if (conCsrf && !METODI_SICURI.has(metodo) && csrfInMemoria !== null) {
        intestazioni['X-CSRF-Token'] = csrfInMemoria;
    }

    let risposta: Response;

    try {
        risposta = await fetch(`/api${percorso}`, {
            method: metodo,
            headers: intestazioni,
            credentials: 'same-origin',
            body: corpo === undefined ? undefined : JSON.stringify(corpo),
        });
    } catch {
        throw new ErroreApi(0);
    }

    if (risposta.status === 204) {
        return undefined;
    }

    // Corpo non JSON (per esempio l'errore di un proxy): nessun dato, non un'eccezione.
    const dati: unknown = await risposta.json().catch(() => null);

    if (!risposta.ok) {
        throw new ErroreApi(risposta.status, {
            codice: eOggetto(dati) && typeof dati.codice === 'string' ? dati.codice : null,
            messaggioServer:
                eOggetto(dati) && typeof dati.messaggio === 'string' ? dati.messaggio : null,
            campi: estraiCampi(dati),
            riprovaTraSec: leggiRiprovaTra(risposta),
        });
    }

    return dati;
}
