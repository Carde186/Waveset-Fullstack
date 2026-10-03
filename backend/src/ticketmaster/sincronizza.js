const { normalizza } = require('./normalizza');
const { ErroreTicketmaster } = require('../servizi/ticketmaster');
const codiceErrore = e => e instanceof ErroreTicketmaster ? e.codice : 'ERRORE_PERSISTENZA';
function backoff(artista, errore, intervalloMs) {
    return Math.max((errore.retrySec ?? 0) * 1000, Math.min(intervalloMs, 900000 * 2 ** Math.min(artista.fallimenti ?? 0, 6)));
}
async function sincronizza({ repository, client, config, adesso = new Date(), ids = null, forza = false }) {
    const stato = await repository.stato();
    if (!forza && stato.prossimo_tentativo && new Date(stato.prossimo_tentativo) > adesso) return { esito: 'cache', artisti: 0, richieste: 0 };
    const artisti = await repository.artisti();
    const scelti = artisti.filter(a => (!ids || ids.includes(a.id)) &&
        (forza || !a.prossimo_tentativo || new Date(a.prossimo_tentativo).getTime() <= adesso.getTime()));
    if (ids && ids.some(id => !artisti.some(a => a.id === id))) throw new Error('ARTISTA_LOCALE_ASSENTE');
    if (!scelti.length) return { esito: 'cache', artisti: 0, richieste: 0 };
    const lotto = scelti.slice(0, config.maxArtisti);
    const oggi = adesso.toISOString().slice(0, 10);
    const da = new Date(adesso.getTime() - 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';
    const r = { esito: 'ok', errore: null, artisti: 0, pubblicati: 0, inCoda: 0, aggiornati: 0, protetti: 0, scartati: 0, assenti: 0, falliti: 0, richieste: 0 };
    let ritardoGlobale = 0;
    for (const artista of lotto) {
        let errore = null;
        try {
            const trovati = await client.cercaPagine({ ...(artista.id_ticketmaster ? { attractionId: artista.id_ticketmaster } : { keyword: artista.nome }), da });
            const visti = new Set();
            for (const raw of trovati.eventi) {
                const fonte = normalizza(raw, artisti);
                if (!fonte) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
                if (!fonte.lineup.some(a => a.artista_id === artista.id) || (fonte.campi.data_evento && fonte.campi.data_evento < oggi)) { r.scartati++; continue; }
                visti.add(fonte.id_esterno);
                r[await repository.salva(fonte, adesso)]++;
            }
            if (!trovati.completa) throw new ErroreTicketmaster('PAGINAZIONE_TRONCATA');
            // Ricerca senza risultati o evento rimosso dai risultati non prova
            // cancellazione: interrogare il dettaglio, solo per ID già locali.
            for (const noto of await repository.noti(artista.id, oggi)) {
                if (visti.has(noto.id_esterno)) continue;
                const raw = await client.recuperaEvento(noto.id_esterno);
                if (raw === null) { await repository.assente(noto.id, adesso); r.assenti++; }
                else {
                    const fonte = normalizza(raw, artisti);
                    if (!fonte || fonte.id_esterno !== noto.id_esterno) throw new ErroreTicketmaster('RISPOSTA_NON_VALIDA');
                    r[await repository.salva(fonte, adesso)]++;
                }
            }
        } catch (e) {
            errore = e; r.falliti++; r.errore = codiceErrore(e);
        }
        const prossimo = new Date(adesso.getTime() + (errore ? backoff(artista, errore, config.intervalloMs) : config.intervalloMs));
        if (errore) ritardoGlobale = Math.max(ritardoGlobale, prossimo.getTime() - adesso.getTime());
        await repository.esitoArtista(artista, adesso, prossimo, errore ? codiceErrore(errore) : null);
        r.artisti++;
        if (errore && ['HTTP_401', 'HTTP_403', 'HTTP_429', 'BUDGET_RICHIESTE', 'INTERROTTO'].includes(codiceErrore(errore))) break;
    }
    r.richieste = client.richieste();
    if (r.falliti || r.artisti < scelti.length || ids) r.esito = r.falliti === r.artisti ? 'errore' : 'parziale';
    r.fallimentiGlobali = r.errore ? (stato.fallimenti ?? 0) + 1 : 0;
    r.prossimo = r.errore ? new Date(adesso.getTime() + Math.max(backoff({ fallimenti: stato.fallimenti ?? 0 }, {}, config.intervalloMs),
        ritardoGlobale)) : null;
    await repository.esitoCiclo(adesso, r);
    return r;
}
module.exports = { sincronizza, backoff };
