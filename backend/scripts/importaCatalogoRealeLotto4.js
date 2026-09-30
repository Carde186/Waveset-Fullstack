// Lotto 4 del catalogo reale (CLAUDE.md, "Catalogo reale"): Calvin Harris
// e David Guetta. David Guetta ha DUE album distinti (non uno): "Just a
// Little More Love" (2002, il suo esordio) e "Nothing But the Beat
// Ultimate" (2011) — Love Don't Let Me Go e Titanium non condividono
// nessun album reale, vanno tenuti separati.
//
// Uso:
//   node scripts/importaCatalogoRealeLotto4.js            (anteprima, nessuna scrittura)
//   node scripts/importaCatalogoRealeLotto4.js --applica  (applica le scritture)
const { eseguiDaCli } = require('./catalogoRealeCondiviso');

const LOTTO = [
    {
        nome: 'Calvin Harris',
        bio: 'DJ e produttore scozzese, tra gli artisti EDM più ascoltati al mondo dagli anni 2010.',
        // MusicBrainz artist MBID 8dd98bdc-80ec-4e93-8509-2f46bafc09a7
        // ("Scottish DJ and producer", score 100) — NOME AMBIGUO: esistono
        // altri due "Calvin Harris" su MusicBrainz (cantante soul
        // statunitense, MBID d4caad3c-..., score 73; chitarrista, MBID
        // 6428a204-..., score 72), risolti dalla disambiguazione. Anche su
        // Apple esistono due artisti "Calvin Harris" (artistId 201955086,
        // genere Dance — il nostro; artistId 1641763794, genere R&B/Soul —
        // il cantante soul, NON usato qui).
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Calvin_Harris_-_Rock_in_Rio_Madrid_2012_-_09.jpg/500px-Calvin_Harris_-_Rock_in_Rio_Madrid_2012_-_09.jpg',
        credito: {
            autore: 'Carlos Delgado',
            licenza: 'CC BY-SA 3.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Calvin_Harris_-_Rock_in_Rio_Madrid_2012_-_09.jpg',
            modificata: false,
        },
        generi: ['House'],
        albums: [
            {
                // MusicBrainz release-group 8b2d4efb-3f3f-4d6e-83f0-
                // dc9d8ad8d8bb, score 100, first-release-date 2014-10-31
                // (stessa data su Spotify; il campo releaseDate del
                // singolo brano su Apple, 2014-03-14, riflette la data del
                // singolo "Summer" pubblicato prima dell'album, non la
                // data dell'album stesso — già verificato che collectionId
                // 922876176 è comunque "Motion", non un prodotto diverso).
                titolo: 'Motion',
                dataPubblicazione: '2014-10-31',
                copertinaUrl: null,
                brani: [
                    {
                        // Solo Calvin Harris (nessun featuring). Spotify
                        // id 6YUTL4dYpB9xZO5qExPf05, Apple trackId
                        // 922876189, stesso collectionId dell'album sopra.
                        titolo: 'Summer',
                        dataPubblicazione: '2014-10-31',
                        urlSpotify:
                            'https://open.spotify.com/track/6YUTL4dYpB9xZO5qExPf05',
                    },
                ],
            },
        ],
        singoli: [],
    },
    {
        nome: 'David Guetta',
        bio: 'DJ e produttore francese, una delle figure più prominenti della musica dance mondiale dagli anni 2000.',
        // MusicBrainz artist MBID 302bd7b9-d012-4360-897a-93b00c855680,
        // score 100, unico risultato plausibile.
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/David_Guetta_%286781730297%29.jpg/500px-David_Guetta_%286781730297%29.jpg',
        credito: {
            autore: 'Thomas Bonte',
            licenza: 'CC BY 2.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:David_Guetta_(6781730297).jpg',
            modificata: false,
        },
        generi: ['House'],
        albums: [
            {
                // MusicBrainz release-group acc73398-4cf6-3603-a329-
                // b518cada9f7f, primary-type Album, score 100 — esiste
                // anche un release-group Single omonimo (41e40ac3-...,
                // 2001-04-13, il singolo apripista), scartato: qui serve
                // l'ALBUM, non il singolo.
                titolo: 'Just a Little More Love',
                dataPubblicazione: '2002-05-20',
                copertinaUrl: null,
                brani: [
                    {
                        // Solo David Guetta (nessun featuring). Apple
                        // scrive il titolo "Love Don't Let Me Go (Original
                        // Edit)" (per distinguerlo dai remix nello stesso
                        // catalogo) mentre Spotify usa il titolo semplice:
                        // qui il titolo semplice, coerente con l'unico
                        // titolo Spotify e con l'assenza di un vero
                        // "feat." da rappresentare — "(Original Edit)" è
                        // un chiarimento di store, non un featuring.
                        // Spotify id 6RCpUWL7aBzH3SnbzkNKM2, Apple trackId
                        // 693179192, stesso collectionId dell'album sopra.
                        titolo: "Love Don't Let Me Go",
                        dataPubblicazione: '2002-05-20',
                        urlSpotify:
                            'https://open.spotify.com/track/6RCpUWL7aBzH3SnbzkNKM2',
                    },
                ],
            },
            {
                // MusicBrainz release-group a2709bdb-e16e-4f71-b1aa-
                // cc68119fb782 ("Nothing but the Beat", score 100,
                // first-release-date 2011-08-24) copre l'edizione base;
                // l'edizione "Ultimate" usata qui (necessaria per il link
                // Apple, l'unica raggiungibile sullo store IT — la
                // standard collectionId 693225996 trovata inizialmente
                // negli USA risulta "non trovata" su IT) non ha un
                // release-group MusicBrainz distinto identificato: stesso
                // album, contenuti extra. Titolo scritto per intero
                // "Nothing But the Beat Ultimate" per combaciare
                // esattamente con collectionName su Apple (confronto
                // esatto in backend/src/itunes/copertina.js).
                titolo: 'Nothing But the Beat Ultimate',
                dataPubblicazione: '2011-08-24',
                copertinaUrl: null,
                brani: [
                    {
                        // Titolo ufficiale identico su entrambe le
                        // piattaforme: "Titanium (feat. Sia)" — feat.
                        // reale nel titolo, non inventato. Spotify id
                        // 0TDLuuLlV54CkRRUOahJb4, Apple trackId 726390516
                        // (collectionId 726390068, raggiungibile su IT —
                        // NON il collectionId 693225996 trovato negli USA,
                        // "non trovato" su IT), stesso collectionId
                        // dell'album sopra.
                        titolo: 'Titanium (feat. Sia)',
                        dataPubblicazione: '2011-08-24',
                        urlSpotify:
                            'https://open.spotify.com/track/0TDLuuLlV54CkRRUOahJb4',
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
