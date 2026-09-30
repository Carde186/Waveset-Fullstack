// Idempotenza di scripts/correggiLotto1.js. Usa un artista/brano di PROVA
// (mai Carl Cox/Charlotte de Witte reali): creato ed eliminato qui, stesso
// pattern di artistaProva in adminEventi.test.js.
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, chiudi } = require('./aiuto');
const { correggi } = require('../scripts/correggiLotto1');

const NOME_PROVA = 'Artista Prova CorreggiLotto1';
const TITOLO_VECCHIO = 'Brano Prova Titolo Vecchio';
const TITOLO_NUOVO = 'Brano Prova Titolo Vecchio (feat. Prova)';

let connessione;
let idArtistaProva;

before(async () => {
    connessione = await db.getConnection();

    const [risultato] = await db.query(
        'INSERT INTO artista (nome) VALUES (?)',
        [NOME_PROVA],
    );
    idArtistaProva = risultato.insertId;

    await db.query(
        'INSERT INTO brano (titolo, artista_id, url_spotify) VALUES (?, ?, NULL)',
        [TITOLO_VECCHIO, idArtistaProva],
    );
});

after(async () => {
    connessione.release();
    await db.query('DELETE FROM artista WHERE id = ?', [idArtistaProva]);
    await chiudi();
});

describe('rinomina titolo: idempotente', () => {
    const rinomina = [
        {
            artistaNome: NOME_PROVA,
            titoloVecchio: TITOLO_VECCHIO,
            titoloNuovo: TITOLO_NUOVO,
        },
    ];

    test('prima applicazione: rinomina; seconda: nessun cambiamento, nessun duplicato', async () => {
        const primo = await correggi(connessione, rinomina, [], true);
        assert.equal(
            primo.find(r => r.tipo === 'rinomina titolo').esito,
            `rinominato — id ${await idBranoProva()}`,
        );

        const secondo = await correggi(connessione, rinomina, [], true);
        assert.equal(
            secondo.find(r => r.tipo === 'rinomina titolo').esito,
            'già corretto (il titolo nuovo esiste già)',
        );

        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM brano WHERE artista_id = ?',
            [idArtistaProva],
        );
        assert.equal(n, 1, 'non deve esserci un duplicato');

        const [[riga]] = await db.query(
            'SELECT titolo FROM brano WHERE artista_id = ?',
            [idArtistaProva],
        );
        assert.equal(riga.titolo, TITOLO_NUOVO);
    });

    async function idBranoProva() {
        const [[riga]] = await db.query(
            'SELECT id FROM brano WHERE artista_id = ?',
            [idArtistaProva],
        );
        return riga.id;
    }
});

describe('popola url_spotify: idempotente, mai sovrascrive', () => {
    const urlSpotify = [
        {
            artistaNome: NOME_PROVA,
            titoli: [TITOLO_NUOVO],
            url: 'https://open.spotify.com/track/prova1',
        },
    ];

    test('prima applicazione: popola; seconda con URL diverso: non sovrascrive', async () => {
        const primo = await correggi(connessione, [], urlSpotify, true);
        assert.match(
            primo.find(r => r.tipo === 'url_spotify').esito,
            /^popolato/,
        );

        const [[riga1]] = await db.query(
            'SELECT url_spotify FROM brano WHERE artista_id = ?',
            [idArtistaProva],
        );
        assert.equal(
            riga1.url_spotify,
            'https://open.spotify.com/track/prova1',
        );

        // Stesso brano, URL diverso nella "correzione": non deve mai
        // sovrascrivere un valore già presente.
        const urlSpotifyDiverso = [
            {
                artistaNome: NOME_PROVA,
                titoli: [TITOLO_NUOVO],
                url: 'https://open.spotify.com/track/prova2-non-deve-scrivere',
            },
        ];
        const secondo = await correggi(
            connessione,
            [],
            urlSpotifyDiverso,
            true,
        );
        assert.match(
            secondo.find(r => r.tipo === 'url_spotify').esito,
            /^già presente, non sovrascritto/,
        );

        const [[riga2]] = await db.query(
            'SELECT url_spotify FROM brano WHERE artista_id = ?',
            [idArtistaProva],
        );
        assert.equal(
            riga2.url_spotify,
            'https://open.spotify.com/track/prova1',
        );
    });
});
