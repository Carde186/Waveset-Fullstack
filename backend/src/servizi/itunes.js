const URL_BASE = 'https://itunes.apple.com';

// API pubblica di Apple: nessuna chiave (verificato con una sonda reale
// prima di scrivere questo modulo). Solo lookup per id (mai /search per
// nome ad ogni apertura — CLAUDE.md, "Catalogo reale"): l'id Apple di ogni
// album è fissato una volta per tutte nella mappatura locale, vedi
// src/itunes/copertina.js.
class ErroreItunes extends Error {
    constructor(messaggio, stato) {
        super(messaggio);
        this.stato = stato;
    }
}

async function ottieniAlbum(collectionId, paese = 'IT') {
    const risposta = await fetch(
        `${URL_BASE}/lookup?id=${collectionId}&country=${paese}`,
    );

    if (!risposta.ok) {
        throw new ErroreItunes(
            `iTunes ha risposto ${risposta.status} per l'album ${collectionId}`,
            risposta.status,
        );
    }

    const corpo = await risposta.json();

    // resultCount 0: id valido come richiesta ma nessun risultato (album
    // rimosso dallo store, o mai esistito) — non un errore HTTP, ma
    // comunque "niente da mostrare".
    if (!corpo.results || corpo.results.length === 0) {
        return null;
    }

    return corpo.results[0];
}

module.exports = { ErroreItunes, ottieniAlbum };
