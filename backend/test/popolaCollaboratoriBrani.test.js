// Idempotenza e sicurezza anti-duplicazione di
// scripts/popolaCollaboratoriBrani.js. Usa un artista/brano di PROVA (mai
// Martin Garrix reale): creato ed eliminato qui.
// Richiede la colonna brano.collaboratori nello schema di test.
const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

// aiuto.db è condiviso nel processo: chiuderlo solo nell'after finale
// di questo file principale in un worker isolato, come nel pilota ricerca.
if (require.main !== module || !process.execArgv.includes('--test-isolation=process')) {
    throw new Error('COLLABORATORI_RICHIEDE_WORKER_ISOLATO');
}
const guardia = require('./preparaAmbiente');
const { db, URL_API, verificaCanarina } = require('./aiuto');
const mysql = require('mysql2/promise');
const { creaRegistro, SCHEMA } = require('./helpers/registroFixture');
const { creaAdapterMysqlRegistro } = require('./helpers/adapterMysqlRegistro');
const { popolaCollaboratori } = require('../scripts/popolaCollaboratoriBrani');

const NOME_PROVA = 'Artista Prova Collaboratori';
const TITOLO_SENZA_NOME = 'Brano Prova Senza Nome Nel Titolo';
const TITOLO_CON_NOME = 'Brano Prova (feat. Collaboratore Prova)';
// SQL letterale della funzione provata: nessun parser SQL generico.
const SQL_RICERCA = `SELECT b.id, b.titolo, b.collaboratori
         FROM brano b
         INNER JOIN artista a ON a.id = b.artista_id
         WHERE a.nome = ? AND b.titolo = ?`;
const SQL_UPDATE = 'UPDATE brano SET collaboratori = ? WHERE id = ?';

let connessione, connessioneFixture, poolPulizia, adapter, registro;
let idArtistaProva, idBranoSenzaNome, idBranoConNome;
const registrate = { artista: [], brano: [] };
const causeTeardown = new WeakMap();

function verificaRicerca(righe, id) {
    assert.ok(Array.isArray(righe) && righe.length === 1 && righe[0].id === id,
        'COLLABORATORI_RICERCA_NON_UNIVOCA_O_PK_DIVERSA');
}

function connessioneControllata() {
    const brani = new Map([
        [TITOLO_SENZA_NOME, idBranoSenzaNome],
        [TITOLO_CON_NOME, idBranoConNome],
    ]);
    return {
        async query(sql, parametri) {
            assert.ok(Array.isArray(parametri) && parametri.length === 2,
                'COLLABORATORI_PARAMETRI_NON_AMMESSI');
            if (sql === SQL_RICERCA) {
                assert.equal(parametri[0], NOME_PROVA, 'COLLABORATORI_ARTISTA_NON_AMMESSO');
                const id = brani.get(parametri[1]);
                const negativa = parametri[1] === 'Brano Prova Mai Importato';
                assert.ok(id !== undefined || negativa, 'COLLABORATORI_TITOLO_NON_AMMESSO');
                const risultato = await connessioneFixture.query(sql, parametri);
                if (negativa) {
                    // Caso negativo originale: non autorizza alcun UPDATE.
                    assert.equal(risultato[0].length, 0, 'COLLABORATORI_RICERCA_NEGATIVA_COLLISIONE');
                } else verificaRicerca(risultato[0], id);
                return risultato;
            }
            assert.equal(sql, SQL_UPDATE, 'COLLABORATORI_SQL_NON_AMMESSO');
            const voce = [...brani].find(([, id]) => id === parametri[1]);
            assert.ok(voce, 'COLLABORATORI_UPDATE_PK_NON_REGISTRATA');
            // Anche il ricontrollo interno e questa lettura immediatamente
            // prima dell'UPDATE devono risolvere la PK registrata.
            const [righe] = await connessioneFixture.query(SQL_RICERCA, [NOME_PROVA, voce[0]]);
            verificaRicerca(righe, voce[1]);
            return connessioneFixture.query(sql, parametri);
        },
    };
}

before(async () => {
    const canarina = await verificaCanarina();
    assert.ok(canarina?.verificata === true && canarina.pulita === true &&
        canarina.righeEliminate === 1, 'COLLABORATORI_CANARINA_NON_ATTESTATA');
    poolPulizia = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: guardia.DB_TEST,
        connectionLimit: 1,
        dateStrings: true,
        decimalNumbers: false,
        timezone: 'Z',
        typeCast: true,
        rowsAsArray: false,
        multipleStatements: false,
        debug: false,
    });
    adapter = await creaAdapterMysqlRegistro({ pool: poolPulizia, guardia, urlApi: URL_API });
    const baseline = await adapter.acquisisciBaseline();
    const attesi = { genere: 4, artista: 6, album: 5, brano: 9, utente: 3,
        playlist: 0, evento: 4, sessioni: 0, artista_genere: 5,
        playlist_brano: 0, evento_artista: 5, utente_artista: 2 };
    assert.ok(Object.entries(attesi).every(([t, n]) => baseline[t].length === n) &&
        JSON.stringify(baseline.utente.map(r => r.id).sort((a, b) => a - b)) === '[1,2,3]',
        'COLLABORATORI_STATO_INIZIALE_INATTESO');
    registro = creaRegistro(baseline);
    connessioneFixture = await db.getConnection();
    const [collisioni] = await connessioneFixture.query(
        'SELECT id FROM artista WHERE nome = ?', [NOME_PROVA]);
    assert.equal(collisioni.length, 0, 'COLLABORATORI_COLLISIONE_FIXTURE');

    await registro.conOperazione(
        () => db.query('INSERT INTO artista (nome) VALUES (?)', [NOME_PROVA]),
        ([esito], { registraId }) => {
            registraId('artista', esito);
            idArtistaProva = esito.insertId;
            registrate.artista.push(idArtistaProva);
        },
    );
    await registro.conOperazione(
        () => db.query('INSERT INTO brano (titolo, artista_id, url_spotify) VALUES (?, ?, NULL)',
            [TITOLO_SENZA_NOME, idArtistaProva]),
        ([esito], { registraId }) => {
            registraId('brano', esito, { artista_id: idArtistaProva, album_id: null });
            idBranoSenzaNome = esito.insertId;
            registrate.brano.push(idBranoSenzaNome);
        },
    );
    await registro.conOperazione(
        () => db.query('INSERT INTO brano (titolo, artista_id, url_spotify) VALUES (?, ?, NULL)',
            [TITOLO_CON_NOME, idArtistaProva]),
        ([esito], { registraId }) => {
            registraId('brano', esito, { artista_id: idArtistaProva, album_id: null });
            idBranoConNome = esito.insertId;
            registrate.brano.push(idBranoConNome);
        },
    );
    connessione = connessioneControllata();
    for (const titolo of [TITOLO_SENZA_NOME, TITOLO_CON_NOME]) {
        await connessione.query(SQL_RICERCA, [NOME_PROVA, titolo]);
    }
});

after(async () => {
    const errori = [], erroriRollback = [];
    const righeAttese = [
        ...registrate.brano.map(id => ({ tabella: 'brano', pk: [id] })),
        ...registrate.artista.map(id => ({ tabella: 'artista', pk: [id] })),
    ];
    const conteggiAttesi = Object.fromEntries(Object.keys(SCHEMA).map(t =>
        [t, registrate[t]?.length ?? 0]));
    try {
        if (registro) {
            const conteggi = await registro.pulisci({
                ...adapter,
                async rollback() {
                    try { await adapter.rollback(); }
                    catch (errore) { erroriRollback.push(errore); }
                },
                async salvaAnteprima(anteprima) {
                    assert.deepEqual(anteprima.righe, righeAttese, 'COLLABORATORI_PIANO_PK_NON_AMMESSE');
                    assert.deepEqual(anteprima.conteggi, conteggiAttesi, 'COLLABORATORI_PIANO_CONTEGGI');
                    await adapter.salvaAnteprima(anteprima);
                },
            });
            assert.deepEqual(conteggi, conteggiAttesi, 'COLLABORATORI_CONTEGGI_FINALI');
        }
    } catch (errore) {
        errori.push({ fase: 'PULIZIA', errore });
    } finally {
        errori.push(...erroriRollback.map(errore => ({ fase: 'ROLLBACK', errore })));
        for (const [fase, chiudi] of [
            ['ADAPTER', () => adapter?.chiudi()],
            ['CONNESSIONE_FIXTURE', () => connessioneFixture?.release()],
            ['POOL_PULIZIA', () => poolPulizia?.end()],
            ['DB_FIXTURE', () => db.end()],
        ]) {
            try { await chiudi(); }
            catch (errore) { errori.push({ fase: `CHIUSURA_${fase}`, errore }); }
        }
    }
    if (errori.length) {
        const fallimento = new AggregateError(errori.map(({ fase }) =>
            new Error(`COLLABORATORI_${fase}_FALLITA`)), 'COLLABORATORI_TEARDOWN_FALLITO');
        causeTeardown.set(fallimento, errori.map(({ errore }) => errore));
        throw fallimento;
    }
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
