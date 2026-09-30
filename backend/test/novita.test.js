// Home collegata al follow: feed Novità (brani ed eventi degli artisti
// seguiti), generi ordinati per affinità, "Esplora per genere" senza gli
// artisti già seguiti. Seed: l'utente A segue Nova Circuit (1, House +
// Techno) e Lucent Wave (3, Trance); l'utente B nessuno.

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { db, UTENTE_A, UTENTE_B, chiama, accedi, chiudi } = require('./aiuto');

const SEGUITI_DA_A = [1, 3];

let utenteA;
let utenteB;

before(async () => {
    utenteA = await accedi(UTENTE_A);
    utenteB = await accedi(UTENTE_B);
});

after(chiudi);

describe('Novità', () => {
    test('chi segue qualcuno: solo brani degli artisti seguiti', async () => {
        const { dati } = await chiama('/novita', { sessione: utenteA });

        assert.equal(dati.personalizzato, true);
        assert.ok(dati.brani.length > 0);
        assert.ok(dati.brani.every(b => SEGUITI_DA_A.includes(b.artista.id)));
    });

    test('chi segue qualcuno: prossimi eventi con almeno un artista seguito', async () => {
        const { dati } = await chiama('/novita', { sessione: utenteA });

        assert.deepEqual(
            dati.eventi.map(e => e.titolo),
            ['Circuiti Live', 'Notte Elettrica'],
        );
        assert.ok(
            dati.eventi.every(e =>
                e.lineup.some(a => SEGUITI_DA_A.includes(a.id)),
            ),
        );
    });

    test('anonimo e chi non segue nessuno: ultime uscite, senza eventi', async () => {
        const anonimo = (await chiama('/novita')).dati;
        const diB = (await chiama('/novita', { sessione: utenteB })).dati;

        assert.equal(anonimo.personalizzato, false);
        assert.equal(diB.personalizzato, false);
        assert.deepEqual(anonimo.eventi, []);
        assert.deepEqual(diB, anonimo);
        // Il catalogo intero contiene anche artisti che A non segue.
        assert.ok(
            anonimo.brani.some(b => !SEGUITI_DA_A.includes(b.artista.id)),
        );
    });
});

describe('Esplora per genere', () => {
    // Fixture di test, non un artista del catalogo reale: mai seguita da
    // nessuno (serve a "suggerimenti"), genere Techno (serve a "filtro per
    // genere") — creata e cancellata qui, non tocca Carl Cox, Charlotte de
    // Witte né i follow/playlist esistenti. Le assunzioni "il catalogo ha
    // esattamente 4 artisti" e "Nova Circuit è l'unico Techno" non reggono
    // più da quando il catalogo reale curato esiste (CLAUDE.md, "Catalogo
    // reale") — questa fixture rende i due test sotto veri indipendentemente
    // da quanti altri artisti Techno esistano in un dato momento.
    let artistaFixture;

    before(async () => {
        const [risultato] = await db.query(
            'INSERT INTO artista (nome) VALUES (?)',
            ['Artista Fixture Esplora Genere'],
        );
        artistaFixture = risultato.insertId;

        const [[{ id: genereTechnoId }]] = await db.query(
            "SELECT id FROM genere WHERE nome = 'Techno'",
        );
        await db.query(
            'INSERT INTO artista_genere (artista_id, genere_id) VALUES (?, ?)',
            [artistaFixture, genereTechnoId],
        );
    });

    after(async () => {
        // Cascata su artista_genere (FK ON DELETE CASCADE, vedi
        // 01_schema.sql): una sola DELETE basta.
        await db.query('DELETE FROM artista WHERE id = ?', [artistaFixture]);
    });

    describe('generi: prima quelli degli artisti seguiti, poi alfabetico', () => {
        // Il numero di generi nel catalogo NON è fisso (CLAUDE.md,
        // "Catalogo reale": "Elettronica" è stato aggiunto dopo che questo
        // test era stato scritto con un elenco di 4 nomi a mano, e si è
        // rotto per questo motivo esatto). Le tre proprietà sotto sono
        // verificate separatamente, sempre a partire dai conteggi reali nel
        // database (mai un elenco di nomi scritto a mano), più un genere
        // fixture per dimostrare che un genere nuovo non viene escluso.
        let genereFixtureId;
        const NOME_GENERE_FIXTURE = 'Zzz Genere Fixture Novità';

        before(async () => {
            const [risultato] = await db.query(
                'INSERT INTO genere (nome) VALUES (?)',
                [NOME_GENERE_FIXTURE],
            );
            genereFixtureId = risultato.insertId;
        });

        after(async () => {
            await db.query('DELETE FROM genere WHERE id = ?', [
                genereFixtureId,
            ]);
        });

        async function conteggiPerUtente(utenteId) {
            const [righe] = await db.query(
                `SELECT g.nome, COUNT(ua.artista_id) AS seguiti
                 FROM genere g
                 LEFT JOIN artista_genere ag ON ag.genere_id = g.id
                 LEFT JOIN utente_artista ua
                     ON ua.artista_id = ag.artista_id AND ua.utente_id = ?
                 GROUP BY g.id, g.nome`,
                [utenteId],
            );
            return righe;
        }

        test('i generi con almeno un follow vengono tutti prima di quelli senza', async () => {
            const conteggi = await conteggiPerUtente(utenteA.utente.id);
            const conSeguiti = new Set(
                conteggi.filter(r => r.seguiti > 0).map(r => r.nome),
            );
            const senzaSeguiti = new Set(
                conteggi.filter(r => r.seguiti === 0).map(r => r.nome),
            );
            // Il confronto sotto proverebbe poco se uno dei due gruppi
            // fosse vuoto: A deve seguire qualcosa in un genere e nulla in
            // almeno un altro (vero per il seed, vedi intestazione file).
            assert.ok(conSeguiti.size > 0);
            assert.ok(senzaSeguiti.size > 0);

            const { dati } = await chiama('/generi', { sessione: utenteA });
            const nomi = dati.map(g => g.nome);

            const ultimoConSeguiti = Math.max(
                ...nomi.map((n, i) => (conSeguiti.has(n) ? i : -1)),
            );
            const primoSenzaSeguiti = Math.min(
                ...nomi.map((n, i) => (senzaSeguiti.has(n) ? i : Infinity)),
            );
            assert.ok(
                ultimoConSeguiti < primoSenzaSeguiti,
                'ogni genere seguito deve precedere ogni genere non seguito',
            );
        });

        test('a parità di follower, i generi sono in ordine alfabetico', async () => {
            // B non segue nessuno (vedi intestazione file): TUTTI i generi
            // hanno seguiti=0 per lui, quindi l'intera lista è un unico
            // gruppo — il confronto più diretto possibile per questa
            // proprietà, senza bisogno di isolare i sottogruppi a parità di
            // conteggio.
            const conteggi = await conteggiPerUtente(utenteB.utente.id);
            assert.ok(conteggi.every(r => r.seguiti === 0));

            const { dati } = await chiama('/generi', { sessione: utenteB });
            const nomi = dati.map(g => g.nome);
            const attesi = [...nomi].sort((a, b) => a.localeCompare(b));

            assert.deepEqual(nomi, attesi);
        });

        test('un genere nuovo, senza nessun follower, compare comunque — non un numero fisso di elementi', async () => {
            const { dati } = await chiama('/generi', { sessione: utenteB });
            const nomi = dati.map(g => g.nome);

            assert.ok(
                nomi.includes(NOME_GENERE_FIXTURE),
                'un genere aggiunto al catalogo deve comparire, qualunque sia il totale attuale',
            );
        });
    });

    test('suggerimenti: esclusi gli artisti già seguiti, solo per chi segue', async () => {
        const ids = async sessione =>
            (await chiama('/artisti?escludi_seguiti=1', { sessione })).dati.map(
                a => a.id,
            );

        const perA = await ids(utenteA);
        // Esplicito: nessuno degli artisti seguiti da A compare.
        assert.ok(perA.every(id => !SEGUITI_DA_A.includes(id)));
        // Esplicito: un artista pertinente e non seguito compare comunque
        // (la fixture, mai seguita da nessuno) — non solo "la lista non è
        // vuota".
        assert.ok(perA.includes(artistaFixture));

        // Anonimo e B non seguono nessuno: il filtro non deve escludere
        // la fixture (né altro) per loro. Nessun numero totale fisso.
        assert.ok((await ids()).includes(artistaFixture));
        assert.ok((await ids(utenteB)).includes(artistaFixture));
    });

    test('ordine per numero di follower, poi per nome', async () => {
        // L'ordine atteso si calcola dai follower reali nel database, non
        // scritto a mano: così i follow fatti nelle prove manuali (Alice,
        // Bob) non rompono il test.
        const [conteggi] = await db.query(
            `SELECT a.nome, COUNT(ua.utente_id) AS follower
             FROM artista a
             LEFT JOIN utente_artista ua ON ua.artista_id = a.id
             GROUP BY a.id, a.nome`,
        );
        const atteso = conteggi
            .sort(
                (x, y) =>
                    y.follower - x.follower || x.nome.localeCompare(y.nome),
            )
            .map(r => r.nome);

        const nomi = (await chiama('/artisti')).dati.map(a => a.nome);

        assert.deepEqual(nomi, atteso);
    });

    test('filtro per genere invariato', async () => {
        const [[{ id: genereTechnoId }]] = await db.query(
            "SELECT id FROM genere WHERE nome = 'Techno'",
        );

        const { dati } = await chiama(`/artisti?genere_id=${genereTechnoId}`);

        // Ogni artista restituito appartiene davvero al genere richiesto:
        // verificato contro artista_genere (la tabella, non la query
        // applicativa che si sta testando), non assunto dal filtro.
        const [membri] = await db.query(
            'SELECT artista_id FROM artista_genere WHERE genere_id = ?',
            [genereTechnoId],
        );
        const idAppartenenti = new Set(membri.map(r => r.artista_id));
        assert.ok(dati.every(a => idAppartenenti.has(a.id)));

        // Almeno la fixture (genere Techno) è inclusa: non si assume che
        // Nova Circuit sia l'unico artista Techno.
        assert.ok(dati.some(a => a.id === artistaFixture));
    });
});
