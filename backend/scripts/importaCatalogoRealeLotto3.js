// Lotto 3 del catalogo reale (CLAUDE.md, "Catalogo reale"): Fred again..
// e ODESZA — introduce anche il genere "Elettronica" (approvato per
// entrambi: House, l'unico genere elettronico già presente, li descrive
// solo per approssimazione — UK bass/electropop il primo, future
// bass/chillwave il secondo). "Elettronica" NON esiste ancora nel
// database: assicuraGenereCreaSeMancante() lo crea qui, dentro la stessa
// transazione di applicaLotto, così non è mai visibile come genere vuoto
// (creato ma senza nessun artista associato) — vedi
// scripts/catalogoRealeCondiviso.js.
//
// Uso:
//   node scripts/importaCatalogoRealeLotto3.js            (anteprima, nessuna scrittura)
//   node scripts/importaCatalogoRealeLotto3.js --applica  (applica le scritture)
const { eseguiDaCli } = require('./catalogoRealeCondiviso');

const LOTTO = [
    {
        nome: 'Fred again..',
        bio: 'Produttore, DJ e polistrumentista britannico, noto per la serie di album "Actual Life" costruita su campioni vocali e momenti di vita quotidiana.',
        // MusicBrainz artist MBID bca46a0c-25c9-42ca-98c2-e64c8a5e337e,
        // score 100, unico risultato plausibile ("Fred again.." con i due
        // punti finali fa parte del nome).
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Fred_again.._au_Festival_Rock_en_Seine_%C3%A0_Paris.jpg/500px-Fred_again.._au_Festival_Rock_en_Seine_%C3%A0_Paris.jpg',
        credito: {
            autore: 'Kiqmah',
            licenza: 'CC0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Fred_again.._au_Festival_Rock_en_Seine_à_Paris.jpg',
            modificata: false,
        },
        generi: ['Elettronica'],
        albums: [
            {
                // MusicBrainz release-group 45ea3afe-4f89-4958-bf67-
                // 14926d10e7bb, score 95 (unico risultato plausibile),
                // titolo completo "Actual Life 2 (February 2 - October 15
                // 2021)" — usato per intero: è così che compare anche su
                // Apple (collectionName identico), necessario per far
                // combaciare la copertina dal vivo in
                // backend/src/itunes/copertina.js (confronto esatto).
                titolo: 'Actual Life 2 (February 2 - October 15 2021)',
                dataPubblicazione: '2021-11-19',
                copertinaUrl: null,
                brani: [
                    {
                        // Solo Fred again.. (nessun featuring). Spotify
                        // id 3Ad6VqoDpOrJ1CbYFOlUOy, Apple trackId
                        // 1594208594, stesso collectionId dell'album sopra.
                        // Nota titolo: Apple scrive "Catrin (The City)"
                        // (Title Case), qui uso la forma Spotify
                        // "Catrin (the city)" — stessa registrazione, sola
                        // differenza di capitalizzazione fra store.
                        titolo: 'Catrin (the city)',
                        dataPubblicazione: '2021-11-19',
                        urlSpotify:
                            'https://open.spotify.com/track/3Ad6VqoDpOrJ1CbYFOlUOy',
                    },
                ],
            },
        ],
        singoli: [
            {
                // Singolo standalone, non appartiene ad "Actual Life 2":
                // album_id NULL. Collaborazione con The Blessed Madonna,
                // MA né Spotify né Apple usano "(feat. ...)" nel titolo del
                // brano (il nome combinato "Fred again.. & The Blessed
                // Madonna" compare solo nel campo artista di Apple) — non
                // inventato un "feat." che l'edizione non usa nel titolo.
                titolo: 'Marea (we’ve lost dancing)',
                dataPubblicazione: '2021-02-22',
                urlSpotify:
                    'https://open.spotify.com/track/1t0Jmqg1pKVBbxjQFZebeR',
            },
        ],
    },
    {
        nome: 'ODESZA',
        bio: 'Duo statunitense di musica elettronica (Harrison Mills e Clayton Knight), fondato a Seattle nel 2012.',
        // MusicBrainz artist MBID 2e222fce-02ae-4221-b1c6-3c3242b423b6,
        // type Group, score 100, unico risultato.
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Odesza_2015.jpg/500px-Odesza_2015.jpg',
        credito: {
            autore: 'Jacob Penderworth',
            licenza: 'CC BY-SA 4.0',
            fonteUrl: 'https://commons.wikimedia.org/wiki/File:Odesza_2015.jpg',
            modificata: false,
        },
        generi: ['Elettronica'],
        albums: [
            {
                // MusicBrainz release-group a7fcb5d4-4ae6-4a29-9e0f-
                // 2a7c678357d1, score 100 — release ORIGINALE 2014, non la
                // "10 Year Anniversary Edition" (2024, contenuti aggiuntivi,
                // release-group diverso).
                titolo: 'In Return',
                dataPubblicazione: '2014-09-08',
                copertinaUrl: null,
                brani: [
                    {
                        // Solo ODESZA (nessun featuring, brano strumentale).
                        // Spotify id 0vtX8UMG38p7IXpP4lZJ2z, Apple trackId
                        // 897564285, stesso collectionId dell'album sopra.
                        titolo: 'Bloom',
                        dataPubblicazione: '2014-09-08',
                        urlSpotify:
                            'https://open.spotify.com/track/0vtX8UMG38p7IXpP4lZJ2z',
                    },
                    {
                        // Titolo: il campo "name" di Spotify è il semplice
                        // "Say My Name" (Zyra solo nell'array artisti); il
                        // trackName di Apple è invece "Say My Name (feat.
                        // Zyra)" — stessa asimmetria di Short Black/Heroes/
                        // Firestone: adottata la forma con featuring
                        // perché Apple la usa davvero nel titolo, non
                        // inventata. Spotify id 1LeItUMezKA1HdCHxYICed,
                        // Apple trackId 897564278,
                        // stesso collectionId dell'album sopra.
                        titolo: 'Say My Name (feat. Zyra)',
                        dataPubblicazione: '2014-09-08',
                        urlSpotify:
                            'https://open.spotify.com/track/1LeItUMezKA1HdCHxYICed',
                    },
                ],
            },
        ],
        singoli: [],
    },
];

module.exports = { LOTTO };

if (require.main === module) {
    eseguiDaCli(LOTTO);
}
