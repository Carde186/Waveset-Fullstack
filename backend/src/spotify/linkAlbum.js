const pool = require('../config/database');

// Mappatura fissa (nome artista + titolo album) -> link Spotify
// ALL'ALBUM (mai il link di un singolo brano — vedi itunes/linkBrano.js
// per quello). Link già verificati in una sessione precedente (artista
// disambiguato per id — non il primo risultato di ricerca — album trovato
// per titolo esatto e data, incrociata con MusicBrainz e Apple): nessuna
// chiamata Spotify a runtime per "ritrovare" un link già noto.
const MAPPATURA_ALBUM_SPOTIFY = [
    {
        artistaNome: 'Carl Cox',
        albumTitolo: 'All Roads Lead to the Dancefloor',
        linkAlbum: 'https://open.spotify.com/album/6p5qiYillRycbleqmPUR53',
    },
    {
        artistaNome: 'Charlotte de Witte',
        albumTitolo: 'Charlotte de Witte',
        linkAlbum: 'https://open.spotify.com/album/7rdrIHvtAcAxbyMTC6fo9a',
    },
    {
        artistaNome: 'Avicii',
        albumTitolo: 'True',
        linkAlbum: 'https://open.spotify.com/album/2H6i2CrWgXE1HookLu8Au0',
    },
    {
        artistaNome: 'Alesso',
        albumTitolo: 'Forever',
        linkAlbum: 'https://open.spotify.com/album/0tRVSbmOwilUucqjzU0fQw',
    },
    {
        artistaNome: 'Fred again..',
        albumTitolo: 'Actual Life 2 (February 2 - October 15 2021)',
        linkAlbum: 'https://open.spotify.com/album/0SFtIrRytNI4kcf93Tbhdf',
    },
    {
        artistaNome: 'ODESZA',
        albumTitolo: 'In Return',
        linkAlbum: 'https://open.spotify.com/album/5SXT6dwhHX56Sos7KMcMF5',
    },
    {
        artistaNome: 'Calvin Harris',
        albumTitolo: 'Motion',
        linkAlbum: 'https://open.spotify.com/album/48zisMeiXniWLzOQghbPqS',
    },
    {
        artistaNome: 'David Guetta',
        albumTitolo: 'Just a Little More Love',
        linkAlbum: 'https://open.spotify.com/album/05zYKC8heu3lCOPIEG9oS4',
    },
    {
        artistaNome: 'David Guetta',
        albumTitolo: 'Nothing But the Beat Ultimate',
        linkAlbum: 'https://open.spotify.com/album/4bTjdxhRRUiWfwj200f9Kl',
    },
    {
        artistaNome: 'Kygo',
        albumTitolo: 'KYGO',
        linkAlbum: 'https://open.spotify.com/album/5BrjR0P59l9SsbODztqs3q',
    },
    // Cloud Nine: presente qui (link Spotify all'album) ma apposta ASSENTE
    // da itunes/copertina.js — nessun album Apple corrispondente esiste
    // (vedi commento in importaCatalogoRealeLotto5.js). Il Dettaglio album
    // mostra quindi solo questo pulsante Spotify, mai un link Apple al
    // singolo Firestone spacciato per link all'album.
    {
        artistaNome: 'Kygo',
        albumTitolo: 'Cloud Nine',
        linkAlbum: 'https://open.spotify.com/album/0uMIzWh1uEpHEBell4rlF8',
    },
];

// Scoped, non un proxy generico: il client passa solo un id album LOCALE
// già esistente; quale link Spotify restituire lo decide sempre e solo
// questa mappatura lato server.
async function trovaLinkAlbumSpotify(albumId) {
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

    const voce = MAPPATURA_ALBUM_SPOTIFY.find(
        v => v.artistaNome === artistaNome && v.albumTitolo === albumTitolo,
    );

    return voce ? voce.linkAlbum : null;
}

module.exports = { MAPPATURA_ALBUM_SPOTIFY, trovaLinkAlbumSpotify };
