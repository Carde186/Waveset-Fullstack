const URL_BASE = 'https://api.deezer.com';

// Deezer, a differenza di Spotify/Ticketmaster, spesso risponde HTTP 200
// con un corpo {"error": {...}} invece di uno status non-2xx — `tipo`
// distingue le due cause ("http" vs "api") per chi vuole loggare/decidere
// diversamente, `stato` resta lo status HTTP della risposta (200 nel caso
// "api", il vero status altrimenti). `codice` è il "code" numerico dentro
// error (solo per tipo "api", altrimenti null) — es. 800 = dato non
// trovato, 4 = quota superata (vedi CODICE_DATI_NON_TROVATI/CODICE_QUOTA in
// routes/admin/deezer.js): serve a chi chiama per distinguere un dato
// davvero assente da un guasto vero, senza dover interpretare il testo del
// messaggio.
class ErroreDeezer extends Error {
    constructor(messaggio, tipo, stato, codice = null) {
        super(messaggio);
        this.tipo = tipo;
        this.stato = stato;
        this.codice = codice;
    }
}

// API pubblica di Deezer: nessuna chiave, nessun token, verificato con una
// sonda reale (Carl Cox, id 3951) prima di scrivere questo modulo.
async function richiedi(percorso) {
    const risposta = await fetch(`${URL_BASE}${percorso}`);

    if (!risposta.ok) {
        throw new ErroreDeezer(
            `Deezer ha risposto ${risposta.status} per ${percorso}`,
            'http',
            risposta.status,
        );
    }

    const dati = await risposta.json();

    if (dati.error) {
        throw new ErroreDeezer(
            `Deezer: ${dati.error.type ?? 'errore'} (${dati.error.code ?? '?'}) per ${percorso}`,
            'api',
            risposta.status,
            dati.error.code ?? null,
        );
    }

    return dati;
}

async function ottieniArtista(artistaId) {
    return richiedi(`/artist/${artistaId}`);
}

async function ottieniAlbum(albumId) {
    return richiedi(`/album/${albumId}`);
}

async function ottieniBraniAlbum(albumId, { limit } = {}) {
    const parametri = new URLSearchParams({ limit: String(limit) });
    const dati = await richiedi(`/album/${albumId}/tracks?${parametri}`);
    return dati.data ?? [];
}

module.exports = {
    ErroreDeezer,
    ottieniArtista,
    ottieniAlbum,
    ottieniBraniAlbum,
};
