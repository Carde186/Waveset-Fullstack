const pool = require('../config/database');

// Mappatura fissa (nome artista + titolo brano) -> link Apple Music ALLA
// TRACCIA (con ?i=<trackId>, mai il link album senza quel parametro — vedi
// itunes/copertina.js per quello). Id di traccia verificati singolarmente
// su Apple in una sessione precedente, non cercati per somiglianza del
// titolo in una tracklist live: un lookup a runtime rischierebbe di
// abbinare il brano sbagliato (es. un remix, un featuring diverso) solo
// perché il titolo assomiglia — qui l'identità è fissa e già verificata,
// nessuna chiamata Apple necessaria per "ritrovare" un link già noto.
//
// "titoli": più di un titolo tollerato per i 2 brani il cui titolo è stato
// corretto per includere un featuring reale (vedi scripts/correggiLotto1.js
// e importaCatalogoRealeLotto1.js) — così questa mappatura funziona sia
// prima sia dopo quella correzione, senza dover coordinare l'ordine.
const MAPPATURA_BRANO_APPLE = [
    {
        artistaNome: 'Carl Cox',
        titoli: ['Short Black', 'Short Black (feat. Juanita Timpanaro)'],
        linkTraccia:
            'https://music.apple.com/it/album/short-black-feat-jaunita-timpanaro/524442022?i=524443471&uo=4',
    },
    {
        artistaNome: 'Carl Cox',
        titoli: ['Bread & Butter'],
        linkTraccia:
            'https://music.apple.com/it/album/bread-and-butter/524442022?i=524443475&uo=4',
    },
    {
        artistaNome: 'Carl Cox',
        titoli: [
            'We Rob Together',
            'We Rob Together (feat. The Digital Primate)',
        ],
        linkTraccia:
            'https://music.apple.com/it/album/we-rob-together-feat-the-digital-primate/524442022?i=524443659&uo=4',
    },
    {
        artistaNome: 'Charlotte de Witte',
        titoli: ['The Realm'],
        linkTraccia:
            'https://music.apple.com/it/album/the-realm/1835870523?i=1835870525&uo=4',
    },
    {
        artistaNome: 'Charlotte de Witte',
        titoli: ['Vidmahe'],
        linkTraccia:
            'https://music.apple.com/it/album/vidmahe/1835870523?i=1835870537&uo=4',
    },
    {
        artistaNome: 'Charlotte de Witte',
        titoli: ['Memento Mori'],
        linkTraccia:
            'https://music.apple.com/it/album/memento-mori/1835870523?i=1835870540&uo=4',
    },
    {
        artistaNome: 'Martin Garrix',
        titoli: ['Animals'],
        linkTraccia:
            'https://music.apple.com/it/album/animals/1670593166?i=1670593167&uo=4',
    },
    {
        // NON APPLICATO al lotto (vedi importaCatalogoRealeLotto5.js): la
        // mappatura è pronta, in attesa della decisione su come
        // rappresentare Bebe Rexha come co-artista prima di scrivere la
        // riga nel database.
        artistaNome: 'Martin Garrix',
        titoli: ['In the Name of Love'],
        linkTraccia:
            'https://music.apple.com/it/album/in-the-name-of-love/1137640898?i=1137641426&uo=4',
    },
    {
        artistaNome: 'Martin Garrix',
        titoli: ['Ocean (feat. Khalid)'],
        linkTraccia:
            'https://music.apple.com/it/album/ocean-feat-khalid/1397556679?i=1397556695&uo=4',
    },
    {
        artistaNome: 'Fred again..',
        titoli: ['Catrin (the city)'],
        linkTraccia:
            'https://music.apple.com/it/album/catrin-the-city/1594208592?i=1594208594&uo=4',
    },
    {
        artistaNome: 'Fred again..',
        titoli: ['Marea (we’ve lost dancing)'],
        linkTraccia:
            'https://music.apple.com/it/album/marea-weve-lost-dancing/1553064273?i=1553064274&uo=4',
    },
    {
        artistaNome: 'Avicii',
        titoli: ['Wake Me Up'],
        linkTraccia:
            'https://music.apple.com/it/album/wake-me-up/1440872730?i=1440872929&uo=4',
    },
    {
        artistaNome: 'Avicii',
        titoli: ['Hey Brother'],
        linkTraccia:
            'https://music.apple.com/it/album/hey-brother/1440872730?i=1440873108&uo=4',
    },
    {
        artistaNome: 'Alesso',
        titoli: ['Destinations'],
        linkTraccia:
            'https://music.apple.com/it/album/destinations/1440859007?i=1440859023&uo=4',
    },
    {
        artistaNome: 'Alesso',
        titoli: ['Heroes (we could be) (feat. Tove Lo)'],
        linkTraccia:
            'https://music.apple.com/it/album/heroes-we-could-be-feat-tove-lo/1440859007?i=1440859014&uo=4',
    },
    {
        artistaNome: 'Kygo',
        titoli: ["Can't Do It On My Own"],
        linkTraccia:
            'https://music.apple.com/it/album/cant-do-it-on-my-own/1747949161?i=1747949551&uo=4',
    },
    {
        artistaNome: 'Kygo',
        titoli: ['Firestone (feat. Conrad Sewell)'],
        linkTraccia:
            'https://music.apple.com/it/album/firestone-feat-conrad-sewell/1033456474?i=1033456598&uo=4',
    },
    {
        artistaNome: 'Calvin Harris',
        titoli: ['Summer'],
        linkTraccia:
            'https://music.apple.com/it/album/summer/922876176?i=922876189&uo=4',
    },
    {
        artistaNome: 'David Guetta',
        titoli: ["Love Don't Let Me Go"],
        linkTraccia:
            'https://music.apple.com/it/album/love-dont-let-me-go-original-edit/693179189?i=693179192&uo=4',
    },
    {
        artistaNome: 'David Guetta',
        titoli: ['Titanium (feat. Sia)'],
        linkTraccia:
            'https://music.apple.com/it/album/titanium-feat-sia/726390068?i=726390516&uo=4',
    },
    {
        artistaNome: 'ODESZA',
        titoli: ['Bloom'],
        linkTraccia:
            'https://music.apple.com/it/album/bloom/897564246?i=897564285&uo=4',
    },
    {
        artistaNome: 'ODESZA',
        titoli: ['Say My Name (feat. Zyra)'],
        linkTraccia:
            'https://music.apple.com/it/album/say-my-name-feat-zyra/897564246?i=897564278&uo=4',
    },
];

// Scoped, non un proxy generico: il client passa solo un id brano LOCALE
// già esistente; quale link Apple restituire lo decide sempre e solo
// questa mappatura lato server, mai un id/URL Apple a piacere del client.
async function trovaLinkBranoApple(branoId) {
    const [righe] = await pool.query(
        `SELECT b.titolo AS branoTitolo, ar.nome AS artistaNome
         FROM brano b
         INNER JOIN artista ar ON ar.id = b.artista_id
         WHERE b.id = ?`,
        [branoId],
    );

    if (righe.length === 0) {
        return null;
    }

    const { branoTitolo, artistaNome } = righe[0];

    const voce = MAPPATURA_BRANO_APPLE.find(
        v => v.artistaNome === artistaNome && v.titoli.includes(branoTitolo),
    );

    return voce ? voce.linkTraccia : null;
}

module.exports = { MAPPATURA_BRANO_APPLE, trovaLinkBranoApple };
