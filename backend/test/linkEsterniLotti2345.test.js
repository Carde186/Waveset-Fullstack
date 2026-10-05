// Coerenza dei link Spotify dei lotti storici: dati statici, nessun accesso al DB.
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { MAPPATURA_ALBUM_SPOTIFY } = require('../src/spotify/linkAlbum');
const { LOTTO: LOTTO_2 } = require('../scripts/importaCatalogoRealeLotto2');
const { LOTTO: LOTTO_3 } = require('../scripts/importaCatalogoRealeLotto3');
const { LOTTO: LOTTO_4 } = require('../scripts/importaCatalogoRealeLotto4');
const { LOTTO: LOTTO_5 } = require('../scripts/importaCatalogoRealeLotto5');

const LOTTI = [...LOTTO_2, ...LOTTO_3, ...LOTTO_4, ...LOTTO_5];

function trovaLinkSpotifyAlbum(artistaNome, albumTitolo) {
    return MAPPATURA_ALBUM_SPOTIFY.find(
        v => v.artistaNome === artistaNome && v.albumTitolo === albumTitolo,
    );
}

describe('ogni brano nei lotti 2-5 ha un url_spotify', () => {
    for (const artista of LOTTI) {
        const tuttiIBrani = [
            ...(artista.albums ?? []).flatMap(a => a.brani),
            ...(artista.singoli ?? []),
        ];
        for (const brano of tuttiIBrani) {
            test(`${artista.nome} — "${brano.titolo}"`, () => {
                assert.match(
                    brano.urlSpotify ?? '',
                    /^https:\/\/open\.spotify\.com\/track\//,
                );
            });
        }
    }
});

describe('ogni album ha un link Spotify statico, Cloud Nine incluso', () => {
    for (const artista of LOTTI) {
        for (const album of artista.albums ?? []) {
            test(`${artista.nome} — "${album.titolo}"`, () => {
                const voce = trovaLinkSpotifyAlbum(artista.nome, album.titolo);
                assert.ok(
                    voce,
                    `manca una voce in MAPPATURA_ALBUM_SPOTIFY per "${album.titolo}"`,
                );
                assert.match(
                    voce.linkAlbum,
                    /^https:\/\/open\.spotify\.com\/album\//,
                );
            });
        }
    }
});

describe('i singoli (album_id NULL) non hanno mappature album', () => {
    for (const artista of LOTTI) {
        for (const singolo of artista.singoli ?? []) {
            test(`${artista.nome} — "${singolo.titolo}" non compare in nessuna mappatura album`, () => {
                // Un singolo non deve MAI avere una voce album associata
                // col suo stesso titolo: confermerebbe che il link del
                // brano dipende solo da sé stesso, mai da un album locale.
                assert.equal(
                    trovaLinkSpotifyAlbum(artista.nome, singolo.titolo),
                    undefined,
                );
            });
        }
    }
});
