import { ErroreApi, richiesta } from './client';
import { normalizzaEvento, type Evento } from './eventi';

export interface ArtistaRevisione {
    id: number;
    nome: string;
    candidato: string | null;
    confermato: string | null;
    daConfermare: boolean;
}
export interface EventoRevisione extends Evento {
    sorgente: 'ticketmaster' | 'manuale';
    stato: 'in_coda' | 'pubblicato' | 'scartato';
    motivo: string | null;
    artisti: ArtistaRevisione[];
}
export interface FonteRevisione {
    snapshot: Record<string, unknown>;
    attractions: { id: string; nome: string | null; url: string | null }[];
    stato: string;
    ultimoControllo: string;
    protetto: boolean;
    modifiche: boolean;
    assenteDal: string | null;
}
function oggetto(v: unknown): Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ErroreApi(200);
    return v as Record<string, unknown>;
}
function stringa(v: unknown): string {
    if (typeof v !== 'string' || !v.trim()) throw new ErroreApi(200);
    return v;
}
function opzionale(v: unknown): string | null {
    return v === null ? null : stringa(v);
}
function booleano(v: unknown): boolean {
    if (typeof v !== 'boolean') throw new ErroreApi(200);
    return v;
}
function numero(v: number) {
    if (!Number.isInteger(v) || v <= 0 || v > 2147483647) throw new ErroreApi(400);
    return v;
}
export function urlTicketmaster(v: unknown): string | null {
    try {
        const u = new URL(String(v));
        return u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            !u.search &&
            !u.hash &&
            /(^|\.)ticketmaster\.[a-z.]+$/.test(u.hostname)
            ? u.href
            : null;
    } catch {
        return null;
    }
}
function normalizza(v: unknown): EventoRevisione {
    const r = oggetto(v);
    const evento = normalizzaEvento(r);
    if (
        !['ticketmaster', 'manuale'].includes(String(r.fonte)) ||
        !['in_coda', 'pubblicato', 'scartato'].includes(String(r.stato))
    )
        throw new ErroreApi(200);
    const artisti = (r.lineup as unknown[]).map((v) => {
        const a = oggetto(v);
        return {
            id: a.id as number,
            nome: stringa(a.nome),
            candidato: opzionale(a.id_attraction_ticketmaster),
            confermato: opzionale(a.id_ticketmaster),
            daConfermare: booleano(a.collegamento_da_confermare),
        };
    });
    return {
        ...evento,
        sorgente: r.fonte as EventoRevisione['sorgente'],
        stato: r.stato as EventoRevisione['stato'],
        motivo: opzionale(r.motivo_revisione),
        artisti,
    };
}
export async function elencaCoda(): Promise<EventoRevisione[]> {
    const r = await richiesta('/admin/eventi/coda');
    if (!Array.isArray(r)) throw new ErroreApi(200);
    const eventi = r
        .map(normalizza)
        .filter((e) => e.sorgente === 'ticketmaster' && e.stato === 'in_coda');
    if (new Set(eventi.map((e) => e.id)).size !== eventi.length) throw new ErroreApi(200);
    return eventi;
}
export async function leggiRevisione(id: number): Promise<EventoRevisione> {
    const evento = normalizza(await richiesta(`/admin/eventi/${numero(id)}`));
    if (evento.id !== id || evento.sorgente !== 'ticketmaster') throw new ErroreApi(404);
    return evento;
}
export async function leggiFonte(id: number): Promise<FonteRevisione | null> {
    let dati: unknown;
    try {
        dati = await richiesta(`/admin/eventi/${numero(id)}/fonte`);
    } catch (e) {
        if (e instanceof ErroreApi && e.stato === 404) return null;
        throw e;
    }
    const r = oggetto(dati);
    const snapshot = oggetto(r.snapshot);
    const attractions =
        snapshot.attractions === undefined
            ? []
            : (() => {
                  if (!Array.isArray(snapshot.attractions)) throw new ErroreApi(200);
                  return snapshot.attractions.map((v) => {
                      const a = oggetto(v);
                      return {
                          id: stringa(a.id),
                          nome: opzionale(a.nome),
                          url: urlTicketmaster(a.url),
                      };
                  });
              })();
    const ultimoControllo = stringa(r.ultimo_controllo);
    const assenteDal = opzionale(r.assente_dal);
    if (
        !Number.isFinite(Date.parse(ultimoControllo)) ||
        (assenteDal && !Number.isFinite(Date.parse(assenteDal)))
    )
        throw new ErroreApi(200);
    return {
        snapshot,
        attractions,
        stato: stringa(r.stato_fonte),
        ultimoControllo,
        assenteDal,
        protetto: booleano(r.protetto_admin),
        modifiche: booleano(r.modifiche_fonte),
    };
}
export async function confermaCollegamento(id: number, artista: number): Promise<void> {
    await richiesta(
        `/admin/eventi/${numero(id)}/artisti/${numero(artista)}/conferma-collegamento`,
        { metodo: 'POST' },
    );
}
export async function decidiEvento(
    id: number,
    azione: 'approva' | 'scarta',
    motivo = '',
): Promise<void> {
    await richiesta(`/admin/eventi/${numero(id)}/${azione}`, {
        metodo: 'POST',
        ...(azione === 'scarta' ? { corpo: { motivo: motivo.trim() } } : {}),
    });
}
