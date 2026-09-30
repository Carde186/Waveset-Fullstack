const pool = require('../config/database');
const servizioItunes = require('../servizi/itunes');

// Mappatura fissa locale -> Apple, per CHIAVE NATURALE (nome artista +
// titolo album), non per id numerico locale: gli id locali (es. 6, 7 in
// questo momento) sono solo il risultato dell'ordine di inserimento e
// cambierebbero su un database nuovo o clonato — vedi CLAUDE.md, "Catalogo
// reale", e backend/scripts/importaCatalogoRealeLotto1.js (stesso principio
// già usato lì per l'idempotenza). Verificati manualmente su iTunes store
// IT prima di scrivere questa mappatura (artista, titolo, tipo Album,
// data — mai un solo match per somiglianza del nome).
const MAPPATURA_ALBUM_APPLE = [
    {
        artistaNome: 'Carl Cox',
        albumTitolo: 'All Roads Lead to the Dancefloor',
        collectionIdApple: 524442022,
    },
    {
        artistaNome: 'Charlotte de Witte',
        albumTitolo: 'Charlotte de Witte',
        collectionIdApple: 1835870523,
    },
    {
        artistaNome: 'Avicii',
        albumTitolo: 'True',
        collectionIdApple: 1440872730,
    },
    {
        artistaNome: 'Alesso',
        albumTitolo: 'Forever',
        collectionIdApple: 1440859007,
    },
    {
        artistaNome: 'Fred again..',
        albumTitolo: 'Actual Life 2 (February 2 - October 15 2021)',
        collectionIdApple: 1594208592,
    },
    // ODESZA "In Return": nessuna voce per "Cloud Nine" di Kygo, apposta —
    // quell'album non esiste come prodotto Apple (ricerca a vuoto sullo
    // store IT), solo il singolo "Firestone" (mappato in linkBrano.js, non
    // qui). Il Dettaglio album di Cloud Nine mostra solo il pulsante
    // Spotify (vedi spotify/linkAlbum.js).
    {
        artistaNome: 'ODESZA',
        albumTitolo: 'In Return',
        collectionIdApple: 897564246,
    },
    {
        artistaNome: 'Calvin Harris',
        albumTitolo: 'Motion',
        collectionIdApple: 922876176,
    },
    {
        artistaNome: 'David Guetta',
        albumTitolo: 'Just a Little More Love',
        collectionIdApple: 693179189,
    },
    {
        artistaNome: 'David Guetta',
        albumTitolo: 'Nothing But the Beat Ultimate',
        collectionIdApple: 726390068,
    },
    {
        artistaNome: 'Kygo',
        albumTitolo: 'KYGO',
        collectionIdApple: 1747949161,
    },
];

async function trovaVoceMappatura(albumId) {
    const [righe] = await pool.query(
        `SELECT al.titolo AS albumTitolo, ar.nome AS artistaNome
         FROM album al
         INNER JOIN artista ar ON ar.id = al.artista_id
         WHERE al.id = ?`,
        [albumId],
    );

    if (righe.length === 0) {
        return null;
    }

    const { albumTitolo, artistaNome } = righe[0];

    return (
        MAPPATURA_ALBUM_APPLE.find(
            voce =>
                voce.artistaNome === artistaNome &&
                voce.albumTitolo === albumTitolo,
        ) ?? null
    );
}

// Endpoint scoped, non un proxy generico: il client passa solo un id
// ALBUM LOCALE già esistente (stesso id che usa per /api/album/:id), mai un
// id Apple a piacere — quale collectionId Apple interrogare lo decide
// sempre e solo questa mappatura lato server.
async function ottieniCopertina(albumId) {
    const voce = await trovaVoceMappatura(albumId);
    if (!voce) {
        return {
            ok: false,
            stato: 404,
            motivo: 'Nessuna copertina Apple associata a questo album',
        };
    }

    let dati;
    try {
        dati = await servizioItunes.ottieniAlbum(voce.collectionIdApple);
    } catch {
        return { ok: false, stato: 502, motivo: 'iTunes non raggiungibile' };
    }

    if (!dati) {
        return {
            ok: false,
            stato: 404,
            motivo: "L'album non è più disponibile su iTunes",
        };
    }

    // Il match non si fida ciecamente dell'id fissato in MAPPATURA_ALBUM_
    // APPLE: se il catalogo Apple cambiasse cosa c'è dietro quell'id (mai
    // visto succedere, ma non impossibile), non si mostra comunque un
    // artwork sbagliato — si passa al fallback.
    const nomeCorrisponde =
        (dati.artistName ?? '').trim().toLowerCase() ===
        voce.artistaNome.trim().toLowerCase();
    const titoloCorrisponde =
        (dati.collectionName ?? '').trim().toLowerCase() ===
        voce.albumTitolo.trim().toLowerCase();

    if (!nomeCorrisponde || !titoloCorrisponde) {
        return {
            ok: false,
            stato: 404,
            motivo: 'Il match salvato non è più valido',
        };
    }

    if (!dati.artworkUrl100 || !dati.collectionViewUrl) {
        // Mai mostrare l'uno senza l'altro (artwork senza link allo store,
        // o viceversa): senza entrambi non c'è nulla da mostrare.
        return {
            ok: false,
            stato: 404,
            motivo: 'Dati incompleti da iTunes per questo album',
        };
    }

    return {
        ok: true,
        dati: {
            artwork_url: dati.artworkUrl100,
            link_store: dati.collectionViewUrl,
        },
    };
}

module.exports = {
    MAPPATURA_ALBUM_APPLE,
    trovaVoceMappatura,
    ottieniCopertina,
};
