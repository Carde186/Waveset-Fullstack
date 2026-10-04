const BASE = 'https://app.ticketmaster.com/discovery/v2/';
class ErroreTicketmaster extends Error {
    constructor(codice, retrySec = 0) {
        super(`Ticketmaster: ${codice}`); // Mai URL, chiave o corpo remoto nei log.
        this.codice = codice;
        this.retrySec = retrySec;
    }
}
function creaClientTicketmaster({
    chiave = process.env.TICKETMASTER_API_KEY, fetchImpl = fetch,
    timeoutMs = 10000, pausaMs = 300, tentativi = 2, maxPagine = 4,
    maxRichieste = 300, ora = Date.now, signal,
    attendi = ms => new Promise(r => setTimeout(r, ms)),
} = {}) {
    let richieste = 0, ultima = -Infinity;
    async function leggi(percorso, query, consenti404 = false) {
        if (typeof chiave !== 'string' || !chiave.trim()) throw new ErroreTicketmaster('CHIAVE_ASSENTE');
        for (let tentativo = 0; ; tentativo++) {
            if (signal?.aborted) throw new ErroreTicketmaster('INTERROTTO');
            if (richieste >= maxRichieste) throw new ErroreTicketmaster('BUDGET_RICHIESTE');
            await attendi(Math.max(0, pausaMs - (ora() - ultima)));
            ultima = ora(); richieste++;
            let risposta;
            try {
                const parametri = new URLSearchParams({ ...query, apikey: chiave });
                const timeout = AbortSignal.timeout(timeoutMs);
                risposta = await fetchImpl(`${BASE}${percorso}?${parametri}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
            } catch {
                if (signal?.aborted) throw new ErroreTicketmaster('INTERROTTO');
                if (tentativo < tentativi) { await attendi(1000 * 2 ** tentativo); continue; }
                throw new ErroreTicketmaster('RETE_TIMEOUT');
            }
            if (consenti404 && risposta.status === 404) return null;
            if (!risposta.ok) {
                const header = risposta.headers.get('retry-after');
                const retry = Math.min(86400, Math.max(0, Number(header) || Math.ceil((Date.parse(header) - ora()) / 1000) || 0));
                if ((risposta.status === 429 || risposta.status >= 500) && tentativo < tentativi && retry <= 30) {
                    await attendi(Math.max(retry * 1000, 1000 * 2 ** tentativo)); continue;
                }
                throw new ErroreTicketmaster(`HTTP_${risposta.status}`, retry);
            }
            let dati;
            try { dati = await risposta.json(); } catch { throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA'); }
            if (!dati || typeof dati !== 'object' || Array.isArray(dati)) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
            return dati;
        }
    }
    async function cercaPagine({ keyword, attractionId, da = new Date(ora()).toISOString().replace(/\.\d{3}Z$/, 'Z') }) {
        if (attractionId ? typeof attractionId !== 'string' || !/^[\w-]{1,64}$/.test(attractionId) : typeof keyword !== 'string' || !keyword.trim()) throw new ErroreTicketmaster('PARAMETRI_NON_VALIDI');
        const risultati = new Map();
        for (let page = 0; page < maxPagine; page++) {
            const dati = await leggi('events.json', { classificationName: 'music', size: '50', page: String(page), sort: 'date,asc', startDateTime: da,
                ...(attractionId ? { attractionId } : { keyword }) });
            const eventi = dati._embedded?.events ?? [];
            if (!Array.isArray(eventi) || (!dati._embedded?.events && dati.page?.totalElements !== 0 && dati.page?.totalPages !== 0)) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
            if (dati.page?.totalPages !== undefined && (!Number.isInteger(dati.page.totalPages) || dati.page.totalPages < 0 || (!dati.page.totalPages && eventi.length))) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
            for (const evento of eventi) {
                if (!evento || typeof evento.id !== 'string') throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
                risultati.set(evento.id, evento);
            }
            const pagine = dati.page?.totalPages;
            if (Number.isInteger(pagine) && pagine >= 0 && page + 1 >= pagine) return { eventi: [...risultati.values()], completa: true };
            if (pagine === undefined && eventi.length < 50 && !dati._links?.next) return { eventi: [...risultati.values()], completa: true };
        }
        return { eventi: [...risultati.values()], completa: false };
    }
    return {
        cercaPagine,
        async cercaAttractions(keyword) {
            if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 200) throw new ErroreTicketmaster('PARAMETRI_NON_VALIDI');
            const risultati = new Map();
            for (let page = 0; page < maxPagine; page++) {
                const dati = await leggi('attractions.json', { keyword: keyword.trim(), size: '200', page: String(page), locale: '*' });
                const elementi = dati._embedded?.attractions;
                if (!Array.isArray(elementi) && !(elementi === undefined && dati.page?.totalElements === 0)) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
                for (const r of elementi ?? []) {
                    if (!r || typeof r.id !== 'string' || !/^[\w-]{1,64}$/.test(r.id) || typeof r.name !== 'string' || !r.name.trim()) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
                    risultati.set(r.id, { id: r.id, name: r.name });
                }
                const pagine = dati.page?.totalPages;
                if (pagine !== undefined && (!Number.isInteger(pagine) || pagine < 0)) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
                if (Number.isInteger(pagine) && page + 1 >= pagine) return [...risultati.values()];
                if (pagine === undefined && (elementi?.length ?? 0) < 200 && !dati._links?.next) return [...risultati.values()];
            }
            throw new ErroreTicketmaster('PAGINAZIONE_TRONCATA');
        },
        recuperaEvento: id => {
            if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) throw new ErroreTicketmaster('ID_NON_VALIDO');
            return leggi(`events/${encodeURIComponent(id)}.json`, {}, true);
        },
        richieste: () => richieste,
    };
}
// Contratti dei vecchi script conservati. Il worker usa un client condiviso
// per tutto il ciclo, così pagine, retry e dettagli rispettano lo stesso budget.
async function cercaEventi(parametri) { return (await creaClientTicketmaster().cercaPagine(parametri)).eventi; }
async function recuperaEvento(id) { return creaClientTicketmaster().recuperaEvento(id); }
module.exports = { creaClientTicketmaster, ErroreTicketmaster, cercaEventi, recuperaEvento };
