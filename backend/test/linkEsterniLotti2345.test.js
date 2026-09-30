// Coerenza fra i LOTTO dei lotti 2-5 (non ancora applicati al database) e
// le mappature statiche Apple/Spotify (src/itunes/linkBrano.js,
// src/itunes/copertina.js, src/spotify/linkAlbum.js): a differenza di
// test/linkEsterniLotto1.test.js (che interroga il container in
// esecuzione, dati già applicati), qui i brani/album non esistono ancora
// nel database — il test verifica solo che i DATI STATICI combacino fra
// loro, senza bisogno del DB: ogni brano/album che i lotti inseriranno ha
// (o volutamente non ha, per Cloud Nine) una mappatura corrispondente,
// per chiave naturale esatta (nome artista + titolo).
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { MAPPATURA_BRANO_APPLE } = require('../src/itunes/linkBrano');
const { MAPPATURA_ALBUM_APPLE } = require('../src/itunes/copertina');
const { MAPPATURA_ALBUM_SPOTIFY } = require('../src/spotify/linkAlbum');
const { LOTTO: LOTTO_2 } = require('../scripts/importaCatalogoRealeLotto2');
const { LOTTO: LOTTO_3 } = require('../scripts/importaCatalogoRealeLotto3');
const { LOTTO: LOTTO_4 } = require('../scripts/importaCatalogoRealeLotto4');
const { LOTTO: LOTTO_5 } = require('../scripts/importaCatalogoRealeLotto5');

const LOTTI = [...LOTTO_2, ...LOTTO_3, ...LOTTO_4, ...LOTTO_5];

function trovaLinkApple(artistaNome, titolo) {
    return MAPPATURA_BRANO_APPLE.find(
        v => v.artistaNome === artistaNome && v.titoli.includes(titolo),
    );
}

function trovaCopertinaApple(artistaNome, albumTitolo) {
    return MAPPATURA_ALBUM_APPLE.find(
        v => v.artistaNome === artistaNome && v.albumTitolo === albumTitolo,
    );
}

function trovaLinkSpotifyAlbum(artistaNome, albumTitolo) {
    return MAPPATURA_ALBUM_SPOTIFY.find(
        v => v.artistaNome === artistaNome && v.albumTitolo === albumTitolo,
    );
}

describe('ogni brano nei lotti 2-5 ha un link Apple statico', () => {
    for (const artista of LOTTI) {
        for (const album of artista.albums ?? []) {
            for (const brano of album.brani) {
                test(`${artista.nome} — "${brano.titolo}" (album "${album.titolo}")`, () => {
                    const voce = trovaLinkApple(artista.nome, brano.titolo);
                    assert.ok(
                        voce,
                        `manca una voce in MAPPATURA_BRANO_APPLE per "${brano.titolo}"`,
                    );
                    assert.match(voce.linkTraccia, /\?i=\d+/);
                    assert.match(
                        voce.linkTraccia,
                        /^https:\/\/music\.apple\.com\/it\//,
                    );
                });
            }
        }
        for (const singolo of artista.singoli ?? []) {
            test(`${artista.nome} — "${singolo.titolo}" (singolo, senza album)`, () => {
                const voce = trovaLinkApple(artista.nome, singolo.titolo);
                assert.ok(
                    voce,
                    `manca una voce in MAPPATURA_BRANO_APPLE per "${singolo.titolo}"`,
                );
                assert.match(voce.linkTraccia, /\?i=\d+/);
            });
        }
    }
});

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

describe('ogni album (tranne Cloud Nine) ha una copertina Apple statica', () => {
    for (const artista of LOTTI) {
        for (const album of artista.albums ?? []) {
            const eCloudNine =
                artista.nome === 'Kygo' && album.titolo === 'Cloud Nine';

            test(`${artista.nome} — "${album.titolo}"${eCloudNine ? ' (atteso: NESSUNA copertina Apple)' : ''}`, () => {
                const voce = trovaCopertinaApple(artista.nome, album.titolo);
                if (eCloudNine) {
                    // Richiesta esplicita: Cloud Nine non ha un album Apple
                    // reale (solo il singolo Firestone) — nessuna voce qui,
                    // il Dettaglio album deve mostrare solo Spotify.
                    assert.equal(
                        voce,
                        undefined,
                        'Cloud Nine non deve avere una copertina Apple',
                    );
                } else {
                    assert.ok(
                        voce,
                        `manca una voce in MAPPATURA_ALBUM_APPLE per "${album.titolo}"`,
                    );
                    assert.equal(typeof voce.collectionIdApple, 'number');
                }
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
                    trovaCopertinaApple(artista.nome, singolo.titolo),
                    undefined,
                );
                assert.equal(
                    trovaLinkSpotifyAlbum(artista.nome, singolo.titolo),
                    undefined,
                );
            });
        }
    }
});
