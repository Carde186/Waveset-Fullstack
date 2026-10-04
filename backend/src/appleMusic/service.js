const { ErroreAppleMusic } = require('./errore');
const { creaClient, pubblico } = require('./client');
const { creaRepository } = require('./repository');
function versione(v) {
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 4294967294)) throw new ErroreAppleMusic('APPLE_PARAMETRI', 400);
    return v;
}
function creaService({ repository = creaRepository(require('../config/database')), client = creaClient() } = {}) {
    return {
        async leggi(id) {
            const artista = await repository.artista(id);
            return { artista, collegamento: await repository.leggi(id) };
        },
        async cerca(id, q) {
            await repository.artista(id);
            return { risultati: (await client.cerca(q)).map(pubblico) };
        },
        async collega(id, corpo) {
            const attesa = versione(corpo?.versione_attesa);
            await repository.artista(id);
            // Conferma sul dettaglio riletto dal server, mai sul payload browser.
            const dati = await client.dettaglio(corpo?.external_id);
            return repository.salva(id, dati, attesa);
        },
        async sincronizza(id, corpo) {
            const attesa = versione(corpo?.versione_attesa);
            await repository.artista(id);
            const link = await repository.leggi(id);
            if (!link) throw new ErroreAppleMusic('APPLE_LINK_ASSENTE', 404);
            if (link.versione !== attesa) throw new ErroreAppleMusic('APPLE_CONFLITTO', 409);
            const dati = await client.dettaglio(link.externalId, link.storefront);
            return repository.salva(id, dati, attesa);
        },
    };
}
module.exports = { creaService };
