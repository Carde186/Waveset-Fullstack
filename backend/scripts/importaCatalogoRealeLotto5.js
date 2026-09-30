// Lotto 5 del catalogo reale (CLAUDE.md, "Catalogo reale"): Martin Garrix
// (2 singoli, nessun album — a differenza degli altri artisti già importati,
// non ha un album Spotify/Apple con brani a paternità singola o
// rappresentativa: entrambi i brani sotto sono singoli standalone, mai
// entrati in un album vero) e Kygo (2 album distinti: "KYGO" e "Cloud
// Nine" non condividono nessun brano, vanno tenuti separati).
//
// Uso:
//   node scripts/importaCatalogoRealeLotto5.js            (anteprima, nessuna scrittura)
//   node scripts/importaCatalogoRealeLotto5.js --applica  (applica le scritture)
const { eseguiDaCli } = require('./catalogoRealeCondiviso');

const LOTTO = [
    {
        nome: 'Martin Garrix',
        bio: 'DJ e produttore olandese, tra i più giovani artisti ad aver raggiunto il numero 1 nella classifica DJ Mag Top 100.',
        // MusicBrainz artist MBID 3e1f2ee4-16be-4406-bf18-6173840cf2b1,
        // score 100 (un secondo risultato "martin garrix", score 78,
        // esplicitamente disambiguato come "parody" — scartato).
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Martin_Garixx_-_Southside_Festival_2022_-_IMG_5074_-_2.jpg/500px-Martin_Garixx_-_Southside_Festival_2022_-_IMG_5074_-_2.jpg',
        credito: {
            autore: 'Mr. Rossi',
            licenza: 'CC BY-SA 4.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Martin_Garixx_-_Southside_Festival_2022_-_IMG_5074_-_2.jpg',
            modificata: false,
        },
        generi: ['House'],
        albums: [],
        singoli: [
            {
                // MusicBrainz release-group d0443288-94a3-4141-a266-
                // c99d58491ce2 ("Animals", Single, nessun secondary-type —
                // l'originale, non uno dei remix: esistono release-group
                // separati "Animals (remixes)" e "Animals (Isaac remix)",
                // scartati). Recording MBID d68b5936-8354-4c2d-8871-
                // 241a52724b24, 304000ms — combacia al millisecondo con
                // Spotify (304228ms) e Apple (304229ms): è l'Original Mix,
                // non la Radio Edit (176xxx ms, brano diverso). Solo
                // Martin Garrix, nessun featuring.
                titolo: 'Animals',
                dataPubblicazione: '2013-06-17',
                urlSpotify:
                    'https://open.spotify.com/track/0A9mHc7oYUoCECqByV8cQR',
            },
            {
                // NON APPLICARE QUESTA RIGA prima di aver deciso come
                // rappresentare Bebe Rexha come co-artista (proposta
                // separata, in attesa di conferma — vedi il messaggio di
                // risposta di questo giro, non ancora implementata):
                // titolo ufficiale identico su Spotify e Apple, "In the
                // Name of Love", SENZA "feat." — Bebe Rexha compare solo
                // nell'array artisti di Spotify e nel campo artistName di
                // Apple ("Martin Garrix & Bebe Rexha", verificato anche
                // sullo store IT). Nessun "(feat. ...)" aggiunto al
                // titolo: l'edizione non lo usa lì. Spotify id
                // 23L5CiUhw2jV1OIMwthR3S (198815ms), Apple trackId
                // 1137641426 (198815ms, collectionId 1137640898,
                // verificato su IT).
                titolo: 'In the Name of Love',
                dataPubblicazione: '2016-07-29',
                urlSpotify:
                    'https://open.spotify.com/track/23L5CiUhw2jV1OIMwthR3S',
            },
            {
                // Terzo brano OPZIONALE, proposto in aggiunta (non in
                // sostituzione di "In the Name of Love"): titolo ufficiale
                // identico su entrambe le piattaforme, "Ocean (feat.
                // Khalid)" — feat. reale nel titolo, nessun problema di
                // rappresentazione (a differenza del brano sopra). Da
                // confermare se includerlo insieme agli altri due prima di
                // applicare questo lotto. Spotify id 3nc420PXjTdBV5TN0gCFkS
                // (216419ms), Apple trackId 1397556695 (216420ms,
                // collectionId 1397556679, verificato su IT).
                titolo: 'Ocean (feat. Khalid)',
                dataPubblicazione: '2018-06-15',
                urlSpotify:
                    'https://open.spotify.com/track/3nc420PXjTdBV5TN0gCFkS',
            },
        ],
    },
    {
        nome: 'Kygo',
        bio: 'DJ e produttore norvegese, tra i pionieri del tropical house.',
        // MusicBrainz artist MBID ba0e7638-0cd6-4ff4-8987-c3e224d22c23,
        // score 100, disambiguazione esplicita "Norwegian DJ & producer
        // Kyrre Gørvell-Dahll".
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Kygo_%2828481718120%29_%282%29_%28cropped%29.jpg/500px-Kygo_%2828481718120%29_%282%29_%28cropped%29.jpg',
        credito: {
            autore: 'The Come Up Show',
            licenza: 'CC BY 2.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Kygo_(28481718120)_(2)_(cropped).jpg',
            // File Commons esplicitamente "(cropped)", stesso caso di
            // Avicii in questo stesso lotto 2: derivato da un originale
            // più ampio.
            modificata: true,
        },
        generi: ['House'],
        albums: [
            {
                // MusicBrainz release-group d46aa03f-f5d6-492a-be3c-
                // 7c02e72b68e2 ("Kygo", Album, score 100, first-release-
                // date 2024-06-21) — non "KYGO (the remixes)" (release-
                // group separato, secondary-type Remix, scartato).
                titolo: 'KYGO',
                dataPubblicazione: '2024-06-21',
                copertinaUrl: null,
                brani: [
                    {
                        // Solo Kygo (nessun featuring). Spotify id
                        // 3Q7VyyNH6u2KMPVa6PtUAW, Apple trackId
                        // 1747949551, stesso collectionId dell'album sopra.
                        titolo: "Can't Do It On My Own",
                        dataPubblicazione: '2024-06-21',
                        urlSpotify:
                            'https://open.spotify.com/track/3Q7VyyNH6u2KMPVa6PtUAW',
                    },
                ],
            },
            {
                // MusicBrainz release-group d1ba5804-1d40-40d1-9f77-
                // 3128bfb3d62d, score 100, first-release-date 2016-05-13.
                // Nessun album Apple corrispondente: ricerca "Kygo Cloud
                // Nine" su Apple IT, zero risultati — solo il singolo
                // "Firestone (feat. Conrad Sewell)" esiste su Apple, non un
                // contenitore "Cloud Nine" (vedi copertina.js: questo
                // album NON è in MAPPATURA_ALBUM_APPLE, apposta — il
                // Dettaglio album mostra solo il pulsante Spotify).
                titolo: 'Cloud Nine',
                dataPubblicazione: '2016-05-13',
                copertinaUrl: null,
                brani: [
                    {
                        // Titolo: il campo "name" di Spotify è il semplice
                        // "Firestone" (Conrad Sewell solo nell'array
                        // artisti); il trackName di Apple per QUESTO
                        // brano è invece "Firestone (feat. Conrad
                        // Sewell)" — stessa asimmetria già vista per Short
                        // Black/Heroes/Say My Name: adottata la forma con
                        // featuring perché Apple la usa davvero nel
                        // titolo, non inventata. Spotify id
                        // 1I8tHoNBFTuoJAlh4hfVVE (271634ms, dentro l'album
                        // "Cloud Nine"), Apple trackId 1033456598 (270787ms,
                        // collectionId 1033456474 — il singolo originale,
                        // unico prodotto Apple esistente per questo brano,
                        // non un album "Cloud Nine" che su Apple non
                        // esiste). Scarto di ~0.8s fra le durate, stesso
                        // ordine di grandezza di Destinations/Hey Brother:
                        // encoding, non un'edizione diversa.
                        titolo: 'Firestone (feat. Conrad Sewell)',
                        dataPubblicazione: '2016-05-13',
                        urlSpotify:
                            'https://open.spotify.com/track/1I8tHoNBFTuoJAlh4hfVVE',
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
