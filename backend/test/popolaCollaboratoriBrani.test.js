// Idempotenza e sicurezza anti-duplicazione di
// scripts/popolaCollaboratoriBrani.js. Usa un artista/brano di PROVA (mai
// Martin Garrix reale): creato ed eliminato qui, stesso pattern di
// test/correggiLotto1.test.js.
//
// Richiede prima lo schema di db/init/12_collaboratori_brano_schema.sql
// applicato (colonna brano.collaboratori): finché non lo è, questi test
// falliscono su un UPDATE/SELECT con colonna sconosciuta — segnale
// corretto, non un difetto del test (stesso principio di
// test/catalogoRealeLotto1.test.js per 11_credito_immagine_schema.sql).
process.env.DB_HOST = '127.0.0.1';

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, chiudi } = require('./aiuto');
const { popolaCollaboratori } = require('../scripts/popolaCollaboratoriBrani');

const NOME_PROVA = 'Artista Prova Collaboratori';
const TITOLO_SENZA_NOME = 'Brano Prova Senza Nome Nel Titolo';
const TITOLO_CON_NOME = 'Brano Prova (feat. Collaboratore Prova)';

let connessione;
let idArtistaProva;
let idBranoSenzaNome;
let idBranoConNome;

before(async () => {
    connessione = await db.getConnection();

    const [risultato] = await db.query(
        'INSERT INTO artista (nome) VALUES (?)',
        [NOME_PROVA],
    );
    idArtistaProva = risultato.insertId;

    const [branoSenzaNome] = await db.query(
        'INSERT INTO brano (titolo, artista_id, url_spotify) VALUES (?, ?, NULL)',
        [TITOLO_SENZA_NOME, idArtistaProva],
    );
    idBranoSenzaNome = branoSenzaNome.insertId;

    const [branoConNome] = await db.query(
        'INSERT INTO brano (titolo, artista_id, url_spotify) VALUES (?, ?, NULL)',
        [TITOLO_CON_NOME, idArtistaProva],
    );
    idBranoConNome = branoConNome.insertId;
});

after(async () => {
    connessione.release();
    await db.query('DELETE FROM artista WHERE id = ?', [idArtistaProva]);
    await chiudi();
});

describe('scrive il collaboratore: idempotente, mai sovrascrive', () => {
    const voci = [
        {
            artistaNome: NOME_PROVA,
            titolo: TITOLO_SENZA_NOME,
            collaboratori: 'Collaboratore Prova',
        },
    ];

    test('anteprima: non scrive nulla', async () => {
        const risultati = await popolaCollaboratori(connessione, voci, false);
        assert.match(
            risultati.find(r => r.brano.includes(TITOLO_SENZA_NOME)).esito,
            /^da scrivere/,
        );

        const [[riga]] = await db.query(
            'SELECT collaboratori FROM brano WHERE id = ?',
            [idBranoSenzaNome],
        );
        assert.equal(riga.collaboratori, null);
    });

    test('prima applicazione: scrive; seconda: non sovrascrive', async () => {
        const primo = await popolaCollaboratori(connessione, voci, true);
        assert.match(
            primo.find(r => r.brano.includes(TITOLO_SENZA_NOME)).esito,
            /^scritto/,
        );

        const [[riga1]] = await db.query(
            'SELECT collaboratori FROM brano WHERE id = ?',
            [idBranoSenzaNome],
        );
        assert.equal(riga1.collaboratori, 'Collaboratore Prova');

        const vociDiverse = [
            {
                artistaNome: NOME_PROVA,
                titolo: TITOLO_SENZA_NOME,
                collaboratori: 'Nome Diverso Non Deve Essere Scritto',
            },
        ];
        const secondo = await popolaCollaboratori(
            connessione,
            vociDiverse,
            true,
        );
        assert.match(
            secondo.find(r => r.brano.includes(TITOLO_SENZA_NOME)).esito,
            /^già presente/,
        );

        const [[riga2]] = await db.query(
            'SELECT collaboratori FROM brano WHERE id = ?',
            [idBranoSenzaNome],
        );
        assert.equal(riga2.collaboratori, 'Collaboratore Prova');
    });
});

describe('sicurezza anti-duplicazione', () => {
    test('rifiuta di scrivere un collaboratore già presente nel titolo', async () => {
        const voci = [
            {
                artistaNome: NOME_PROVA,
                titolo: TITOLO_CON_NOME,
                collaboratori: 'Collaboratore Prova',
            },
        ];

        await assert.rejects(
            () => popolaCollaboratori(connessione, voci, true),
            /compare già nel titolo/,
        );

        const [[riga]] = await db.query(
            'SELECT collaboratori FROM brano WHERE id = ?',
            [idBranoConNome],
        );
        assert.equal(
            riga.collaboratori,
            null,
            'non deve aver scritto nulla prima di fermarsi',
        );
    });

    test('la stessa protezione vale anche in anteprima (nessuna scrittura comunque)', async () => {
        const voci = [
            {
                artistaNome: NOME_PROVA,
                titolo: TITOLO_CON_NOME,
                collaboratori: 'collaboratore prova', // case diversa, deve combaciare comunque
            },
        ];

        await assert.rejects(
            () => popolaCollaboratori(connessione, voci, false),
            /compare già nel titolo/,
        );
    });
});

describe('brano non ancora importato', () => {
    test('segnala "non trovato", non lancia errore', async () => {
        const voci = [
            {
                artistaNome: NOME_PROVA,
                titolo: 'Brano Prova Mai Importato',
                collaboratori: 'Chiunque',
            },
        ];

        const risultati = await popolaCollaboratori(connessione, voci, true);
        assert.match(
            risultati.find(r => r.brano.includes('Mai Importato')).esito,
            /non trovato/,
        );
    });
});
