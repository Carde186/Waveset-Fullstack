const { ErroreProvider } = require('./errore');
const { pubblico } = require('./profilo');
const { creaRepository, nonVerificato } = require('./repository');
const { creaControllo, normalizzaNome } = require('./presenzaTicketmaster');
function creaService({ provider = 'deezer', repository = creaRepository(require('../config/database'), provider),
    client = require('../deezer/client').creaClient(),
    controllaTicketmaster = creaControllo() } = {}) {
    if (provider !== 'deezer') throw new ErroreProvider('PROVIDER_CONFIGURAZIONE', 503);
    const prefisso = 'DEEZER';
    const versione = v => {
        if (v !== null && (!Number.isInteger(v) || v < 1 || v > 4294967294)) throw new ErroreProvider(`${prefisso}_PARAMETRI`, 400);
        return v;
    };
    const profilo = r => ({ ...pubblico(r), provider, fan: r.fan ?? null, immagine: r.artwork?.url ?? null });
    async function controlla(link) {
        try { return await controllaTicketmaster(link.name); }
        catch { return { ...nonVerificato(), controllatoAt: new Date().toISOString() }; }
    }
    return {
        async leggi(id) {
            const artista = await repository.artista(id), link = await repository.leggi(id);
            return { provider, artista, collegamento: link ? { ...profilo(link), ticketmaster: await repository.leggiPresenza(id, link) } : null };
        },
        async cerca(id, q) {
            await repository.artista(id);
            return { provider, risultati: (await client.cerca(q)).map(profilo) };
        },
        async collega(id, corpo) {
            const attesa = versione(corpo?.versione_attesa);
            await repository.artista(id);
            const dati = await client.dettaglio(corpo?.external_id);
            const link = profilo(await repository.salva(id, dati, attesa));
            const esito = await controlla(link);
            // Il profilo è già confermato: anche un guasto della persistenza
            // del controllo informativo non può annullare il collegamento.
            try { return { ...link, ticketmaster: await repository.salvaPresenza(id, link, esito) }; }
            catch { return { ...link, ticketmaster: nonVerificato() }; }
        },
        async sincronizza(id, corpo) {
            const attesa = versione(corpo?.versione_attesa);
            await repository.artista(id);
            const link = await repository.leggi(id);
            if (!link) throw new ErroreProvider(`${prefisso}_LINK_ASSENTE`, 404);
            if (link.versione !== attesa) throw new ErroreProvider(`${prefisso}_CONFLITTO`, 409);
            const dati = await client.dettaglio(link.externalId, link.storefront);
            const nuovo = profilo(await repository.salva(id, dati, attesa));
            return { ...nuovo, ticketmaster: await repository.leggiPresenza(id, nuovo) };
        },
        async ricontrolla(id, corpo) {
            const attesa = versione(corpo?.versione_attesa);
            await repository.artista(id);
            const link = await repository.leggi(id);
            if (!link) throw new ErroreProvider(`${prefisso}_LINK_ASSENTE`, 404);
            if (link.versione !== attesa) throw new ErroreProvider(`${prefisso}_CONFLITTO`, 409);
            return { ...profilo(link), ticketmaster: await repository.salvaPresenza(id, link, await controlla(link)) };
        },
        async confermaTicketmaster(id, corpo) {
            const valido = v => v === null || (typeof v === 'string' && /^[\w-]{1,64}$/.test(v));
            if (!corpo || Object.keys(corpo).length !== 3 ||
                !['attraction_id','attraction_attesa','versione_attesa'].every(k => Object.hasOwn(corpo, k)) ||
                !valido(corpo.attraction_id) || !valido(corpo.attraction_attesa)) throw new ErroreProvider('DEEZER_PARAMETRI', 400);
            const attesa = versione(corpo.versione_attesa);
            const artista = await repository.artista(id), link = await repository.leggi(id);
            if (!link) throw new ErroreProvider('DEEZER_LINK_ASSENTE', 404);
            if (link.versione !== attesa) throw new ErroreProvider('DEEZER_CONFLITTO', 409);
            let esito = null;
            if (corpo.attraction_id !== null) {
                esito = await controlla(link);
                if (esito.stato === 'non_verificato') throw new ErroreProvider('TICKETMASTER_NON_VERIFICATO', 503);
                if (normalizzaNome(artista.nome) !== normalizzaNome(link.name) ||
                    !esito.attractions.some(a => a.id === corpo.attraction_id && normalizzaNome(a.name) === normalizzaNome(link.name))) throw new ErroreProvider('TICKETMASTER_IDENTITA_INVALIDA', 400);
            }
            return { ...profilo(link), ticketmaster: await repository.confermaIdentita(id, link,
                corpo.attraction_id, corpo.attraction_attesa, esito) };
        },
    };
}
module.exports = { creaService };
