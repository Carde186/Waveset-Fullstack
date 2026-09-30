const URL_TOKEN = 'https://accounts.spotify.com/api/token';
const URL_RICERCA = 'https://api.spotify.com/v1/search';
const URL_BASE_ARTISTI = 'https://api.spotify.com/v1/artists';
const URL_BASE_ALBUM = 'https://api.spotify.com/v1/albums';

// Con `stato` (status HTTP), come ErroreRichiesta lato app: chi chiama può
// distinguere un rate limit (429) da un errore generico senza fare parsing
// del messaggio.
class ErroreSpotify extends Error {
    constructor(messaggio, stato) {
        super(messaggio);
        this.stato = stato;
    }
}

// Cache in memoria del token, con margine di sicurezza: la usa l'anteprima
// ADMIN (chiamata ad ogni apertura schermata, non una tantum come le sonde
// da terminale) per non richiedere un token nuovo ad ogni richiesta. Mai
// loggato né esposto: solo tenuto in una variabile di modulo.
const MARGINE_SICUREZZA_MS = 60_000;
let tokenCache = null;

// Client Credentials Flow (solo per popolare il catalogo in fase di seed /
// per l'anteprima ADMIN, CLAUDE.md — niente OAuth, niente dati utente).
async function ottieniToken() {
    if (tokenCache && Date.now() < tokenCache.scadenza) {
        return tokenCache.valore;
    }

    const credenziali = Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`,
    ).toString('base64');

    const risposta = await fetch(URL_TOKEN, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${credenziali}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });

    if (!risposta.ok) {
        // Mai il corpo della risposta: potrebbe descrivere l'errore
        // richiamando le credenziali inviate. Solo endpoint e status.
        throw new ErroreSpotify(
            `Spotify ha risposto ${risposta.status} per ${URL_TOKEN}`,
            risposta.status,
        );
    }

    const dati = await risposta.json();
    tokenCache = {
        valore: dati.access_token,
        scadenza: Date.now() + dati.expires_in * 1000 - MARGINE_SICUREZZA_MS,
    };
    return tokenCache.valore;
}

// GET /artists/{id}: lookup diretto per id già noto, non una ricerca per
// nome — usata dall'anteprima ADMIN (artista fisso, niente ambiguità da
// risolvere come in cercaArtisti).
async function ottieniArtista(artistaId, token) {
    const url = `${URL_BASE_ARTISTI}/${artistaId}`;

    const risposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!risposta.ok) {
        throw new ErroreSpotify(
            `Spotify ha risposto ${risposta.status} per ${url}`,
            risposta.status,
        );
    }

    return risposta.json();
}

// limit/market passati esplicitamente da chi chiama, nessun valore fisso
// nascosto qui dentro: la sonda decide limit=5/market='IT', un futuro seed
// potrebbe voler altri valori.
async function cercaArtisti(nome, token, { limit, market } = {}) {
    const parametri = new URLSearchParams({
        q: nome,
        type: 'artist',
        limit: String(limit),
        market,
    });
    const url = `${URL_RICERCA}?${parametri}`;

    const risposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!risposta.ok) {
        throw new ErroreSpotify(
            `Spotify ha risposto ${risposta.status} per ${URL_RICERCA}`,
            risposta.status,
        );
    }

    const dati = await risposta.json();
    return dati.artists?.items ?? [];
}

// Nessun include_groups fisso qui dentro: chi chiama decide se e come
// filtrare. Restituisce anche "next" e "total" dell'oggetto di
// paginazione: chi chiama decide se richiedere altre pagine, questa
// funzione non lo fa da sola.
async function ottieniAlbumArtista(artistaId, token, { limit, market } = {}) {
    const parametri = new URLSearchParams({
        limit: String(limit),
        market,
    });
    const url = `${URL_BASE_ARTISTI}/${artistaId}/albums?${parametri}`;

    const risposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!risposta.ok) {
        throw new ErroreSpotify(
            `Spotify ha risposto ${risposta.status} per ${url}`,
            risposta.status,
        );
    }

    const dati = await risposta.json();
    return { items: dati.items ?? [], total: dati.total, next: dati.next };
}

// Stesso pattern delle altre: token ricevuto da chi chiama, nessuna pagina
// successiva richiesta da sola — restituisce "next"/"total" così chi chiama
// può deciderlo.
async function ottieniBraniAlbum(albumId, token, { limit, market } = {}) {
    const parametri = new URLSearchParams({
        limit: String(limit),
        market,
    });
    const url = `${URL_BASE_ALBUM}/${albumId}/tracks?${parametri}`;

    const risposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!risposta.ok) {
        throw new ErroreSpotify(
            `Spotify ha risposto ${risposta.status} per ${url}`,
            risposta.status,
        );
    }

    const dati = await risposta.json();
    return { items: dati.items ?? [], total: dati.total, next: dati.next };
}

module.exports = {
    ErroreSpotify,
    ottieniToken,
    ottieniArtista,
    cercaArtisti,
    ottieniAlbumArtista,
    ottieniBraniAlbum,
};
