// Lotto 2 del catalogo reale (CLAUDE.md, "Catalogo reale"): Avicii e
// Alesso. Stesso principio di idempotenza del lotto 1 (mai un UPDATE su
// una riga già presente, chiave naturale, transazione aperta/chiusa da
// applicaLotto) — vedi scripts/catalogoRealeCondiviso.js per l'infrastruttura
// condivisa fra i lotti 2+.
//
// Identità verificate su MusicBrainz (MBID sotto), foto con licenza libera
// verificate singolarmente su Wikimedia Commons. Nessuna copertina con
// licenza libera verificata per questi album: copertinaUrl resta null
// (fallback già gestito da src/componenti/Immagine.tsx).
//
// Uso:
//   node scripts/importaCatalogoRealeLotto2.js            (anteprima, nessuna scrittura)
//   node scripts/importaCatalogoRealeLotto2.js --applica  (applica le scritture)
const { eseguiDaCli } = require('./catalogoRealeCondiviso');

const LOTTO = [
    {
        nome: 'Avicii',
        bio: 'DJ e produttore svedese, tra i nomi più influenti della scena EDM globale degli anni 2010, scomparso nel 2018.',
        // MusicBrainz artist MBID c85cfd6b-b1e9-4a50-bd55-eb725f04f7d5,
        // score 100, unico risultato plausibile.
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Avicii_2014_001_%28cropped%29.png/500px-Avicii_2014_001_%28cropped%29.png',
        credito: {
            autore: 'The Perfect World Foundation',
            licenza: 'CC BY 3.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Avicii_2014_001_(cropped).png',
            // File Commons esplicitamente "(cropped)": derivato da un
            // originale più ampio, non un ritaglio fatto da noi — ma il
            // file che usiamo è comunque una versione modificata rispetto
            // all'originale caricato, quindi true (diverso dagli altri
            // artisti di questo lotto, i cui file non sono ritagli).
            modificata: true,
        },
        generi: ['House'],
        albums: [
            {
                // MusicBrainz release-group 61180839-f4a7-407f-b86f-
                // 24c48eef4066, primary-type Album, nessun secondary-type —
                // l'edizione standard, non "True: Avicii By Avicii" (release-
                // group diverso, 1538cd31-..., una ristampa remix separata).
                // Data: MusicBrainz first-release-date (fonte più affidabile
                // delle date regionali difformi viste su Spotify 2013-09-16
                // e Apple 2013-06-17 per la stessa edizione).
                titolo: 'True',
                dataPubblicazione: '2013-09-13',
                copertinaUrl: null,
                brani: [
                    {
                        // Spotify/Apple: solo "Avicii" nell'artist-credit e
                        // nel titolo (nessun "feat."). La voce di Aloe
                        // Blacc è pubblicamente nota (copertina, liner
                        // notes) ma non è accreditata nei metadati
                        // ufficiali di nessuna delle due piattaforme — non
                        // aggiunto un "(feat. ...)" che l'edizione non usa.
                        // Apple: trackId 1440872929, edizione standard
                        // "True" (collectionId 1440872730) — NON la
                        // Bonus Edition (collectionId 1530325442, stesso
                        // brano ma durata leggermente diversa, 247427ms
                        // contro i 249688ms di questa edizione): scelta
                        // l'edizione standard per restare coerente con
                        // l'album sopra, non la durata più vicina a
                        // Spotify (247426ms) — la differenza di ~2s è
                        // trattata come normale scarto di encoding fra
                        // piattaforme, non come prova di un master diverso.
                        titolo: 'Wake Me Up',
                        dataPubblicazione: '2013-09-13',
                        urlSpotify:
                            'https://open.spotify.com/track/0nrRP2bk19rLc0orkWPQk2',
                    },
                    {
                        // Stesso ragionamento di sopra: voce di Dan
                        // Tyminski nota pubblicamente ma non accreditata
                        // nei metadati. Apple trackId 1440873108, edizione
                        // standard "True".
                        titolo: 'Hey Brother',
                        dataPubblicazione: '2013-09-13',
                        urlSpotify:
                            'https://open.spotify.com/track/4lhqb6JvbHId48OUJGwymk',
                    },
                ],
            },
        ],
        singoli: [],
    },
    {
        nome: 'Alesso',
        bio: 'DJ e produttore svedese di progressive house, una delle figure di riferimento della scena EDM europea dagli anni 2010.',
        // MusicBrainz artist MBID addb00fd-733c-4223-8fdf-f78be2488acd,
        // score 100 — un secondo "Alesso" (Franco Alesso, produttore
        // techno argentino, MBID 24170499-..., score 73) scartato: persona
        // diversa, genere diverso, disambiguazione esplicita su MusicBrainz.
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/Alesso_en_Utop%C3%ADa_Festival_2016.jpg/500px-Alesso_en_Utop%C3%ADa_Festival_2016.jpg',
        credito: {
            autore: 'Ruben Ortega',
            licenza: 'CC BY-SA 4.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Alesso_en_Utopía_Festival_2016.jpg',
            modificata: false,
        },
        generi: ['House'],
        albums: [
            {
                // MusicBrainz release-group 84e0fefe-ab7e-414c-a7d1-
                // 707ef357f3a4, primary-type Album, first-release-date
                // 2015-05-22 — stessa data su Spotify e Apple.
                titolo: 'Forever',
                dataPubblicazione: '2015-05-22',
                copertinaUrl: null,
                brani: [
                    {
                        // Traccia 8/14 dell'album, solo Alesso (nessun
                        // featuring). Apple trackId 1440859023, stesso
                        // collectionId 1440859007 dell'album sopra.
                        titolo: 'Destinations',
                        dataPubblicazione: '2015-05-22',
                        urlSpotify:
                            'https://open.spotify.com/track/53ccDZYdOil1QZ85rcrJvo',
                    },
                    {
                        // Traccia 3/14 dello STESSO album (non il singolo
                        // standalone del 2014, edizione diversa e non più
                        // raggiungibile sullo store Apple IT — verificato,
                        // "non trovato"): Spotify id 3zU9rdflI65tK4dkkNSp77,
                        // Apple trackId 1440859014, entrambi dentro
                        // "Forever", stesso collectionId di Destinations.
                        // Titolo: il trackName di Apple per QUESTA traccia
                        // (non solo il nome della collection) è
                        // letteralmente "Heroes (we could be) [feat. Tove
                        // Lo]" — verificato sul singolo brano, non solo sul
                        // nome dell'album. Spotify mostra invece il titolo
                        // senza "feat." (Tove Lo solo nell'array artisti) —
                        // stessa asimmetria già vista per Short Black di
                        // Carl Cox: si adotta la forma con featuring perché
                        // almeno un'edizione (qui Apple, a livello di
                        // singolo brano) la usa davvero nel titolo, non
                        // inventata.
                        titolo: 'Heroes (we could be) (feat. Tove Lo)',
                        dataPubblicazione: '2015-05-22',
                        urlSpotify:
                            'https://open.spotify.com/track/3zU9rdflI65tK4dkkNSp77',
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
