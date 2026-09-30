const servizioDeezer = require('../servizi/deezer');

// Codici del corpo {"error": {"code": ...}} di Deezer (vedi
// src/servizi/deezer.js): presi da una libreria client open source di
// terzi, non dalla documentazione ufficiale Deezer (irraggiungibile in
// questa sessione, gated dietro login) — se in futuro risultassero
// sbagliati, l'effetto pratico è solo che un dato davvero assente
// verrebbe trattato come guasto (più prudente, mai il contrario).
const CODICE_DATI_NON_TROVATI = 800;
const CODICE_QUOTA_SUPERATA = 4;

function eDatoNonTrovato(errore) {
    return (
        errore instanceof servizioDeezer.ErroreDeezer &&
        errore.tipo === 'api' &&
        errore.codice === CODICE_DATI_NON_TROVATI
    );
}

function eQuotaSuperata(errore) {
    return (
        errore instanceof servizioDeezer.ErroreDeezer &&
        errore.tipo === 'api' &&
        errore.codice === CODICE_QUOTA_SUPERATA
    );
}

// Orchestrazione condivisa tra l'anteprima ADMIN (routes/admin/deezer.js) e
// la sezione "Scopri su Deezer" in Home per utenti autenticati
// (routes/deezer.js): stessa chiamata a servizi/deezer.js, stessa gestione
// di dato-assente vs guasto vero, un solo posto da correggere se le regole
// cambiano. Ogni route resta libera di scegliere quali campi esporre (es.
// niente immagini per la sezione Home).
async function costruisciAnteprima(artistaId, albumId, limiteBrani) {
    let artista;
    try {
        artista = await servizioDeezer.ottieniArtista(artistaId);
    } catch {
        // Senza l'artista non c'è niente da mostrare: errore totale, non un
        // dato mancante parziale.
        return { ok: false, stato: 502, messaggio: 'Deezer non raggiungibile' };
    }

    // allSettled, non all: un guasto vero su una delle due chiamate (rete,
    // quota, un errore Deezer diverso da "dato non trovato") non deve mai
    // diventare in automatico un falso "dato assente" solo perché l'altra
    // chiamata gira dentro lo stesso Promise.all — vanno ispezionate una
    // per una.
    const [risultatoAlbum, risultatoBrani] = await Promise.allSettled([
        servizioDeezer.ottieniAlbum(albumId),
        servizioDeezer.ottieniBraniAlbum(albumId, { limit: limiteBrani }),
    ]);

    for (const risultato of [risultatoAlbum, risultatoBrani]) {
        if (risultato.status !== 'rejected') {
            continue;
        }
        if (eDatoNonTrovato(risultato.reason)) {
            // Dato davvero assente (Deezer lo dichiara esplicitamente):
            // stato vuoto legittimo, gestito sotto — non un errore.
            continue;
        }
        // Guasto vero: non si traveste da "dato assente". Fa fallire
        // l'intera risposta, come per l'artista.
        const quota = eQuotaSuperata(risultato.reason);
        return {
            ok: false,
            stato: quota ? 503 : 502,
            messaggio: quota
                ? 'Troppe richieste a Deezer, riprova più tardi'
                : 'Deezer non raggiungibile',
        };
    }

    const album =
        risultatoAlbum.status === 'fulfilled' ? risultatoAlbum.value : null;
    const brani =
        risultatoBrani.status === 'fulfilled' ? risultatoBrani.value : [];

    return {
        ok: true,
        dati: {
            artista: {
                nome: artista.name,
                foto_url: artista.picture_medium ?? null,
                url_deezer: artista.link ?? null,
            },
            album: album
                ? {
                      id: album.id,
                      titolo: album.title,
                      copertina_url: album.cover_medium ?? null,
                      url_deezer: album.link ?? null,
                  }
                : null,
            // Mai external/preview: solo i campi minimi richiesti, mai
            // l'URL di anteprima audio (che Deezer include come "preview"
            // nel brano).
            brani: brani.slice(0, limiteBrani).map(t => ({
                id: t.id,
                titolo: t.title,
                durata_secondi: t.duration,
                url_deezer: t.link ?? null,
            })),
        },
    };
}

module.exports = { costruisciAnteprima };
