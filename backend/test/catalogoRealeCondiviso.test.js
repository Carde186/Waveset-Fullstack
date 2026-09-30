// Idempotenza, integrità e sicurezza di scripts/catalogoRealeCondiviso.js
// (infrastruttura condivisa dai lotti 2-5 del catalogo reale). Stesso
// pattern di test/catalogoRealeLotto1.test.js: voci di PROVA, mai i nomi
// reali (Avicii, Alesso, Fred again.., ODESZA, ...) o quelli demo — questo
// file gira a ogni `npm test`.
//
// Copre in più, rispetto al lotto 1: un artista con PIÙ di un album, un
// brano SENZA album (`album_id` NULL), e la creazione di un genere non
// ancora esistente (assicuraGenereCreaSeMancante) — le tre novità che i
// lotti 2-5 introducono rispetto al lotto 1.
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, chiudi } = require('./aiuto');
const {
    applicaLotto,
    assicuraArtista,
    assicuraGenereCreaSeMancante,
} = require('../scripts/catalogoRealeCondiviso');

const NOME_PROVA = 'Artista Prova Condiviso Lotto';
const NOME_PROVA_SINGOLO = 'Artista Prova Condiviso Singolo';
const NOME_PROVA_A = 'Artista Prova Condiviso A';
const NOME_PROVA_AMBIGUO = 'Artista Prova Condiviso Ambiguo 1';
const NOME_PROVA_AMBIGUO_2 = 'Artista Prova Condiviso Ambiguo 2';
const NOME_PROVA_GENERE = 'Artista Prova Condiviso Genere';
const GENERE_PROVA = 'Genere Di Prova Condiviso';

function voceProva(nome, { generi = ['Techno'] } = {}) {
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
        generi,
        // Due album (a differenza del lotto 1, che ne aveva sempre uno
        // solo per artista): copre il caso reale di Kygo/David Guetta.
        albums: [
            {
                titolo: `Album 1 di ${nome}`,
                dataPubblicazione: '2020-01-01',
                copertinaUrl: null,
                brani: [
                    {
                        titolo: `Brano 1 di ${nome}`,
                        dataPubblicazione: '2020-01-01',
                        urlSpotify: null,
                    },
                ],
            },
            {
                titolo: `Album 2 di ${nome}`,
                dataPubblicazione: '2021-01-01',
                copertinaUrl: null,
                brani: [
                    {
                        titolo: `Brano 2 di ${nome}`,
                        dataPubblicazione: '2021-01-01',
                        urlSpotify: null,
                    },
                ],
            },
        ],
        // Un singolo senza album (a differenza del lotto 1): copre il caso
        // reale di Martin Garrix/Marea.
        singoli: [
            {
                titolo: `Singolo di ${nome}`,
                dataPubblicazione: '2019-01-01',
                urlSpotify: null,
            },
        ],
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

let connessione;

before(async () => {
    connessione = await db.getConnection();
});

after(async () => {
    connessione.release();
    await db.query('DELETE FROM artista WHERE nome IN (?)', [
        [
            NOME_PROVA,
            NOME_PROVA_SINGOLO,
            NOME_PROVA_A,
            NOME_PROVA_AMBIGUO,
            NOME_PROVA_AMBIGUO_2,
            NOME_PROVA_GENERE,
        ],
    ]);
    // Il genere di prova non ha ON DELETE CASCADE dall'artista (è il
    // contrario: artista_genere dipende da genere, non genere da artista),
    // quindi va ripulito a parte.
    await db.query('DELETE FROM genere WHERE nome = ?', [GENERE_PROVA]);
    await chiudi();
});

describe('idempotenza con più album e un singolo (voci di prova)', () => {
    test('la stessa voce, applicata due volte, non duplica nulla', async () => {
        const primo = await applicaLotto(connessione, LOTTO_PROVA, true);
        assert.equal(primo.find(r => r.tipo === 'artista').esito, 'inserito');
        assert.equal(
            primo.filter(r => r.tipo === 'album' && r.esito === 'inserito')
                .length,
            2,
        );
        assert.equal(
            primo.filter(r => r.tipo === 'brano' && r.esito === 'inserito')
                .length,
            2,
        );
        assert.equal(
            primo.find(r => r.tipo === 'brano (singolo, senza album)').esito,
            'inserito',
        );

        const secondo = await applicaLotto(connessione, LOTTO_PROVA, true);
        assert.ok(
            secondo
                .filter(r => r.tipo !== 'genere')
                .every(r => r.esito === 'già presente'),
        );

        const [[{ n: album }]] = await db.query(
            `SELECT COUNT(*) AS n FROM album
             WHERE artista_id = (SELECT id FROM artista WHERE nome = ?)`,
            [NOME_PROVA],
        );
        assert.equal(album, 2);

        const [[{ n: brani }]] = await db.query(
            `SELECT COUNT(*) AS n FROM brano
             WHERE artista_id = (SELECT id FROM artista WHERE nome = ?)`,
            [NOME_PROVA],
        );
        assert.equal(brani, 3, '2 brani nei due album + 1 singolo');

        const [[singolo]] = await db.query(
            `SELECT album_id FROM brano
             WHERE artista_id = (SELECT id FROM artista WHERE nome = ?)
               AND titolo = ?`,
            [NOME_PROVA, `Singolo di ${NOME_PROVA}`],
        );
        assert.equal(
            singolo.album_id,
            null,
            'il singolo deve avere album_id NULL',
        );
    });
});

describe('brano senza album: link indipendenti da un album locale', () => {
    test('un artista con solo un singolo (nessun album) viene inserito correttamente', async () => {
        const voce = {
            ...voceProva(NOME_PROVA_SINGOLO),
            albums: [],
            singoli: [
                {
                    titolo: `Unico singolo di ${NOME_PROVA_SINGOLO}`,
                    dataPubblicazione: '2022-01-01',
                    urlSpotify: 'https://esempio.test/singolo',
                },
            ],
        };

        const risultati = await applicaLotto(connessione, [voce], true);
        assert.equal(
            risultati.find(r => r.tipo === 'artista').esito,
            'inserito',
        );
        assert.equal(
            risultati.find(r => r.tipo === 'brano (singolo, senza album)')
                .esito,
            'inserito',
        );
        assert.equal(
            risultati.filter(r => r.tipo === 'album').length,
            0,
            'nessun album deve essere stato creato',
        );

        const [[brano]] = await db.query(
            `SELECT b.album_id, b.url_spotify FROM brano b
             INNER JOIN artista a ON a.id = b.artista_id
             WHERE a.nome = ?`,
            [NOME_PROVA_SINGOLO],
        );
        assert.equal(brano.album_id, null);
        assert.equal(brano.url_spotify, 'https://esempio.test/singolo');
    });
});

describe('creazione di un genere non ancora esistente', () => {
    test('anteprima: segnala "da creare", non scrive nulla', async () => {
        const [[{ n: prima }]] = await db.query(
            'SELECT COUNT(*) AS n FROM genere WHERE nome = ?',
            [GENERE_PROVA],
        );
        assert.equal(prima, 0);

        const [artista] = await db.query(
            'INSERT INTO artista (nome) VALUES (?)',
            [NOME_PROVA_GENERE],
        );

        const risultato = await assicuraGenereCreaSeMancante(
            connessione,
            artista.insertId,
            GENERE_PROVA,
            false,
        );
        assert.match(risultato.esito, /da creare \(anteprima\)/);

        const [[{ n: dopo }]] = await db.query(
            'SELECT COUNT(*) AS n FROM genere WHERE nome = ?',
            [GENERE_PROVA],
        );
        assert.equal(dopo, 0, 'la sola anteprima non deve creare il genere');
    });

    test('applicazione: crea il genere e lo associa, una volta sola anche con due artisti', async () => {
        const lottoDue = [
            voceProva(NOME_PROVA_A, { generi: [GENERE_PROVA] }),
            voceProva(NOME_PROVA_AMBIGUO, { generi: [GENERE_PROVA] }),
        ];
        // NOME_PROVA_AMBIGUO qui non è ambiguo (una sola riga): riusato solo
        // come nome comodo già ripulito in after(), non per testare
        // l'ambiguità (quella è nel describe successivo con un'istanza
        // dedicata del client).

        const risultati = await applicaLotto(connessione, lottoDue, true);
        const generi = risultati.filter(r => r.tipo === 'genere');
        assert.equal(generi.length, 2);
        assert.ok(generi.some(r => r.esito === 'genere creato e associato'));

        const [[{ n: righeGenere }]] = await db.query(
            'SELECT COUNT(*) AS n FROM genere WHERE nome = ?',
            [GENERE_PROVA],
        );
        assert.equal(righeGenere, 1, 'il genere deve esistere una sola volta');

        const [[{ n: associazioni }]] = await db.query(
            `SELECT COUNT(*) AS n FROM artista_genere ag
             INNER JOIN genere g ON g.id = ag.genere_id
             INNER JOIN artista a ON a.id = ag.artista_id
             WHERE g.nome = ? AND a.nome IN (?)`,
            [GENERE_PROVA, [NOME_PROVA_A, NOME_PROVA_AMBIGUO]],
        );
        assert.equal(associazioni, 2, 'entrambi gli artisti associati');

        // Pulizia dedicata: NOME_PROVA_AMBIGUO viene riutilizzato più sotto
        // per un vero test di ambiguità, deve ripartire da zero.
        await db.query('DELETE FROM artista WHERE nome = ?', [
            NOME_PROVA_AMBIGUO,
        ]);
    });
});

describe('chiave naturale ambigua: mai scelta arbitraria', () => {
    test('due artisti con lo stesso nome già presenti: assicuraArtista si ferma, non ne sceglie uno', async () => {
        await db.query('INSERT INTO artista (nome) VALUES (?), (?)', [
            NOME_PROVA_AMBIGUO_2,
            NOME_PROVA_AMBIGUO_2,
        ]);

        await assert.rejects(
            () =>
                assicuraArtista(
                    connessione,
                    voceProva(NOME_PROVA_AMBIGUO_2),
                    true,
                ),
            /Più righe trovate/,
        );

        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM artista WHERE nome = ?',
            [NOME_PROVA_AMBIGUO_2],
        );
        assert.equal(n, 2);
    });
});

describe('interruzione a metà: tutto o niente', () => {
    test('un errore sulla seconda voce annulla anche la prima, già scritta nella stessa transazione', async () => {
        const nomeOk = 'Artista Prova Condiviso Interrotto OK';
        const nomeAmbiguo = 'Artista Prova Condiviso Interrotto Ambiguo';
        await db.query('INSERT INTO artista (nome) VALUES (?), (?)', [
            nomeAmbiguo,
            nomeAmbiguo,
        ]);

        await assert.rejects(
            () =>
                applicaLotto(
                    connessione,
                    [voceProva(nomeOk), voceProva(nomeAmbiguo)],
                    true,
                ),
            /Più righe trovate/,
        );

        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM artista WHERE nome = ?',
            [nomeOk],
        );
        assert.equal(n, 0);

        await db.query('DELETE FROM artista WHERE nome IN (?)', [
            [nomeOk, nomeAmbiguo],
        ]);
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

    test('follow e playlist (inclusa la playlist "Alba") non cambiano', async () => {
        const [[followPrima]] = await db.query(
            'SELECT COUNT(*) AS n FROM utente_artista',
        );
        const [[playlistPrima]] = await db.query(
            'SELECT COUNT(*) AS n FROM playlist_brano',
        );

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
