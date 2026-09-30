// Idempotenza, integrità e sicurezza (chiave ambigua, interruzione a metà)
// di scripts/importaCatalogoRealeLotto1.js. Usa voci di PROVA (nomi
// distinti da Carl Cox/Charlotte de Witte: questo file gira a ogni
// `npm test`, non deve mai inserire i dati reali del lotto), create ed
// eliminate qui — stesso pattern di artistaProva in adminEventi.test.js.
//
// Richiede lo schema di db/init/11_credito_immagine_schema.sql già
// applicato (colonne immagine_autore/licenza/fonte_url/modificata su
// artista): finché non lo è, i test che scrivono davvero falliscono su un
// INSERT con colonna sconosciuta — segnale corretto, non un difetto del
// test.
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, chiudi } = require('./aiuto');
const {
    applicaLotto,
    assicuraArtista,
    assicuraBrano,
} = require('../scripts/importaCatalogoRealeLotto1');

const NOME_PROVA = 'Artista Prova Lotto Reale';
const NOME_PROVA_A = 'Artista Prova Lotto Reale A';
const NOME_PROVA_AMBIGUO = 'Artista Prova Lotto Reale Ambiguo 1';
const NOME_PROVA_AMBIGUO_2 = 'Artista Prova Lotto Reale Ambiguo 2';

function voceProva(nome) {
    return {
        nome,
        bio: 'Voce di prova, non un artista reale.',
        immagineUrl: 'https://esempio.test/prova.jpg',
        credito: {
            autore: 'Autore di prova',
            licenza: 'CC BY 4.0',
            fonteUrl: 'https://esempio.test/fonte-prova',
            modificata: false,
        },
        genereNome: 'Techno',
        album: {
            titolo: `Album ${nome}`,
            dataPubblicazione: '2020-01-01',
            copertinaUrl: null,
            brani: [
                {
                    titolo: `Brano 1 di ${nome}`,
                    dataPubblicazione: '2020-01-01',
                    urlSpotify: null,
                },
                {
                    titolo: `Brano 2 di ${nome}`,
                    dataPubblicazione: '2020-01-01',
                    urlSpotify: null,
                },
            ],
        },
    };
}

const LOTTO_PROVA = [voceProva(NOME_PROVA)];

const ID_ARTISTI_DEMO = [1, 2, 3, 4];
const NOMI_DEMO_ATTESI = {
    1: 'Nova Circuit',
    2: 'Sunset Grid',
    3: 'Lucent Wave',
    4: 'Break Signal',
};

// applicaLotto gestisce la transazione al suo interno (vedi lo script):
// serve una connessione dedicata dal pool, non il pool condiviso.
let connessione;

before(async () => {
    connessione = await db.getConnection();
});

after(async () => {
    connessione.release();
    // Cascata su artista_genere/album/brano (FK ON DELETE CASCADE, vedi
    // 01_schema.sql): una DELETE per nome basta a ripulire tutto quello
    // che questo file ha creato, comprese le righe ambigue del test 3.
    await db.query('DELETE FROM artista WHERE nome IN (?)', [
        [NOME_PROVA, NOME_PROVA_A, NOME_PROVA_AMBIGUO, NOME_PROVA_AMBIGUO_2],
    ]);
    await chiudi();
});

describe('idempotenza del lotto (voce di prova, non Carl Cox/Charlotte de Witte)', () => {
    test('la stessa voce, applicata due volte, non duplica nulla', async () => {
        const primo = await applicaLotto(connessione, LOTTO_PROVA, true);
        assert.equal(primo.find(r => r.tipo === 'artista').esito, 'inserito');
        assert.equal(primo.find(r => r.tipo === 'album').esito, 'inserito');
        assert.equal(
            primo.filter(r => r.tipo === 'brano' && r.esito === 'inserito')
                .length,
            2,
        );

        const secondo = await applicaLotto(connessione, LOTTO_PROVA, true);
        assert.equal(
            secondo.find(r => r.tipo === 'artista').esito,
            'già presente',
        );
        assert.equal(
            secondo.find(r => r.tipo === 'album').esito,
            'già presente',
        );
        assert.ok(
            secondo
                .filter(r => r.tipo === 'brano')
                .every(r => r.esito === 'già presente'),
        );

        const [[{ n: artisti }]] = await db.query(
            'SELECT COUNT(*) AS n FROM artista WHERE nome = ?',
            [NOME_PROVA],
        );
        assert.equal(artisti, 1);

        const [[{ n: brani }]] = await db.query(
            `SELECT COUNT(*) AS n FROM brano
             WHERE artista_id = (SELECT id FROM artista WHERE nome = ?)`,
            [NOME_PROVA],
        );
        assert.equal(brani, 2);

        const [[{ n: album }]] = await db.query(
            `SELECT COUNT(*) AS n FROM album
             WHERE artista_id = (SELECT id FROM artista WHERE nome = ?)`,
            [NOME_PROVA],
        );
        assert.equal(album, 1);
    });
});

describe('titoliPrecedenti: tollera un brano già presente col titolo vecchio', () => {
    test('trovato col titolo precedente: "già presente", nessun duplicato, titolo NON toccato', async () => {
        const [[artistaProva]] = await db.query(
            'SELECT id FROM artista WHERE nome = ?',
            [NOME_PROVA],
        );
        // Creata dal test di idempotenza sopra: riusa lo stesso artista di
        // prova, aggiunge solo un brano col "titolo vecchio" scritto a
        // mano (non tramite lo script), a simulare un DB non ancora
        // corretto da scripts/correggiLotto1.js.
        await db.query(
            'INSERT INTO brano (titolo, artista_id, url_spotify) VALUES (?, ?, NULL)',
            ['Titolo Vecchio Di Prova', artistaProva.id],
        );

        const risultato = await assicuraBrano(
            connessione,
            artistaProva.id,
            null,
            {
                titolo: 'Titolo Vecchio Di Prova (feat. Qualcuno)',
                titoliPrecedenti: ['Titolo Vecchio Di Prova'],
                dataPubblicazione: null,
                urlSpotify: 'https://esempio.test/non-deve-essere-scritto',
            },
            true,
        );

        assert.equal(risultato.esito, 'già presente');

        const [[riga]] = await db.query(
            'SELECT titolo, url_spotify FROM brano WHERE id = ?',
            [risultato.id],
        );
        // Né il titolo né url_spotify vengono toccati su una riga già
        // presente, anche se trovata solo grazie a titoliPrecedenti: la
        // correzione resta compito esclusivo di scripts/correggiLotto1.js.
        assert.equal(riga.titolo, 'Titolo Vecchio Di Prova');
        assert.equal(riga.url_spotify, null);

        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM brano WHERE artista_id = ? AND titolo LIKE ?',
            [artistaProva.id, 'Titolo Vecchio Di Prova%'],
        );
        assert.equal(n, 1, 'non deve esserci un duplicato');
    });
});

describe('chiave naturale ambigua: mai scelta arbitraria', () => {
    test('due artisti con lo stesso nome già presenti: assicuraArtista si ferma, non ne sceglie uno', async () => {
        // Stato scomodo ma possibile (nessun vincolo UNIQUE su
        // artista.nome — vedi 01_schema.sql): due righe con lo stesso
        // nome, inserite qui direttamente, non tramite lo script.
        await db.query('INSERT INTO artista (nome) VALUES (?), (?)', [
            NOME_PROVA_AMBIGUO,
            NOME_PROVA_AMBIGUO,
        ]);

        await assert.rejects(
            () =>
                assicuraArtista(
                    connessione,
                    voceProva(NOME_PROVA_AMBIGUO),
                    true,
                ),
            /Più righe trovate/,
        );

        // Ancora due, non tre: lo script non ha inserito una riga in più
        // pensando che "non ci fosse" l'artista, né ha scritto altro.
        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM artista WHERE nome = ?',
            [NOME_PROVA_AMBIGUO],
        );
        assert.equal(n, 2);
    });
});

describe('interruzione a metà: tutto o niente', () => {
    test('un errore sulla seconda voce annulla anche la prima, già scritta nella stessa transazione', async () => {
        // La prima voce (NOME_PROVA_A) non esiste ancora: assicuraArtista
        // la inserirebbe con successo. La seconda ha un nome già
        // ambiguo (due righe, stesso trucco del test sopra): il suo
        // assicuraArtista lancia un errore a metà di applicaLotto, DOPO
        // che la prima voce è già stata scritta nella stessa transazione
        // — è la stessa situazione di un crash a metà o di un guasto di
        // rete verso Ticketmaster/MusicBrainz durante l'esecuzione reale.
        await db.query('INSERT INTO artista (nome) VALUES (?), (?)', [
            NOME_PROVA_AMBIGUO_2,
            NOME_PROVA_AMBIGUO_2,
        ]);

        await assert.rejects(
            () =>
                applicaLotto(
                    connessione,
                    [voceProva(NOME_PROVA_A), voceProva(NOME_PROVA_AMBIGUO_2)],
                    true,
                ),
            /Più righe trovate/,
        );

        // La prima voce, scritta con successo PRIMA dell'errore sulla
        // seconda, deve comunque risultare assente: il rollback della
        // transazione annulla tutto il lotto, non solo la voce fallita.
        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM artista WHERE nome = ?',
            [NOME_PROVA_A],
        );
        assert.equal(n, 0);
    });
});

describe('integrità dei dati esistenti', () => {
    test('gli ID e i nomi dei 4 artisti demo non cambiano', async () => {
        const [righe] = await db.query(
            'SELECT id, nome FROM artista WHERE id IN (?)',
            [ID_ARTISTI_DEMO],
        );
        const perId = Object.fromEntries(righe.map(r => [r.id, r.nome]));

        for (const id of ID_ARTISTI_DEMO) {
            assert.equal(
                perId[id],
                NOMI_DEMO_ATTESI[id],
                `artista demo id ${id}`,
            );
        }
    });

    test('follow e playlist non cambiano applicando il lotto di prova', async () => {
        const [[followPrima]] = await db.query(
            'SELECT COUNT(*) AS n FROM utente_artista',
        );
        const [[playlistPrima]] = await db.query(
            'SELECT COUNT(*) AS n FROM playlist_brano',
        );

        // Già applicato dal test di idempotenza sopra: qui deve risultare
        // tutto "già presente", non una nuova scrittura.
        await applicaLotto(connessione, LOTTO_PROVA, true);

        const [[followDopo]] = await db.query(
            'SELECT COUNT(*) AS n FROM utente_artista',
        );
        const [[playlistDopo]] = await db.query(
            'SELECT COUNT(*) AS n FROM playlist_brano',
        );

        assert.equal(followDopo.n, followPrima.n);
        assert.equal(playlistDopo.n, playlistPrima.n);
    });
});
