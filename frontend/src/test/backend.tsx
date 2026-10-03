import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../App';
import { ProviderAutenticazione } from '../autenticazione/ContestoAutenticazione';
import type { Utente } from '../api/tipi';

export const ALICE: Utente = { id: 7, nome: 'Alice', email: 'alice@esempio.test', ruolo: 'USER' };
export const CSRF = 'c'.repeat(64);

export function json(stato: number, corpo: unknown, intestazioni: Record<string, string> = {}) {
    return new Response(JSON.stringify(corpo), {
        status: stato,
        headers: { 'Content-Type': 'application/json', ...intestazioni },
    });
}

export const senzaCorpo = (stato: number) => new Response(null, { status: stato });

export const sessioneDi = (utente: Utente = ALICE, csrf: string = CSRF) => ({ utente, csrf });

export interface Chiamata {
    metodo: string;
    percorso: string;
    corpo: unknown;
    intestazioni: Record<string, string>;
    init: RequestInit;
}

type Gestore = (chiamata: Chiamata) => Response | Promise<Response>;

// Backend finto: si dichiarano SOLO gli endpoint attesi ("METODO /percorso"). Una
// chiamata a un endpoint non dichiarato fa fallire il test: il frontend non deve
// usare nulla che non esista.
export function simulaBackend(rotte: Record<string, Gestore | Response>) {
    const chiamate: Chiamata[] = [];

    const finto = vi.fn(async (indirizzo: RequestInfo | URL, init: RequestInit = {}) => {
        const metodo = (init.method ?? 'GET').toUpperCase();
        const percorso = String(indirizzo);
        const chiamata: Chiamata = {
            metodo,
            percorso,
            corpo: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
            intestazioni: { ...(init.headers as Record<string, string> | undefined) },
            init,
        };

        chiamate.push(chiamata);

        // Stato di base condiviso: Ticketmaster non configurato nelle fixture
        // dei flussi precedenti. I test della sync dichiarano la propria risposta.
        const gestore = rotte[`${metodo} ${percorso}`] ?? (metodo === 'GET' && percorso === '/api/eventi/sincronizzazione'
            ? json(200, { configurata: false, attiva: false, ultimo_tentativo: null, ultimo_successo: null,
                dati_vecchi: true, errore_temporaneo: false, parziale: false, intervallo_secondi: 28800 }) : undefined);

        if (gestore === undefined) {
            throw new Error(`Chiamata non prevista dal test: ${metodo} ${percorso}`);
        }

        return typeof gestore === 'function' ? gestore(chiamata) : gestore.clone();
    });

    vi.stubGlobal('fetch', finto);

    return {
        chiamate,
        fetch: finto,
        di: (metodo: string, percorso: string) =>
            chiamate.filter((c) => c.metodo === metodo && c.percorso === percorso),
    };
}

export function renderizzaApp(percorso = '/') {
    return render(
        <MemoryRouter initialEntries={[percorso]}>
            <ProviderAutenticazione>
                <App />
            </ProviderAutenticazione>
        </MemoryRouter>,
    );
}

// Promessa che si risolve quando il test lo decide: per fermare una richiesta «in corso».
export function differita<T>() {
    let risolvi!: (valore: T) => void;
    const promessa = new Promise<T>((r) => {
        risolvi = r;
    });

    return { promessa, risolvi };
}

export const SESSIONE_NON_VALIDA = () => json(401, { messaggio: 'Sessione non valida' });
