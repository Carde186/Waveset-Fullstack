// Fixture temporanee: non cambiano i seed né i dati iniziali del DB.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { db, verificaCanarina } = require('../aiuto');

async function creaCatalogoPubblico({ utenteId, completo = true } = {}) {
    await verificaCanarina();
    const suffisso = randomUUID();
    const artisti = [], brani = [], eventi = [];
    const possedute = [];
    async function inserisci(tabella, sql, parametri) {
        const [r] = await db.query(sql, parametri);
        assert(Number.isSafeInteger(r.insertId) && r.insertId > 0);
        possedute.push({ tabella, id: r.insertId });
        return r.insertId;
    }
    async function pulisci() {
        // Solo le PK restituite dalle INSERT di questa fixture; le FK
        // eliminano associazioni e follow degli artisti temporanei.
        for (const tabella of ['evento', 'brano', 'artista']) {
            for (const voce of possedute.filter(v => v.tabella === tabella)) {
                const [r] = await db.query(`DELETE FROM ${tabella} WHERE id = ?`, [voce.id]);
                assert.equal(r.affectedRows, 1, 'FIXTURE_PUBBLICA_PULIZIA_INATTESA');
            }
        }
        possedute.length = 0;
    }
    async function aggiungiEvento({ titolo, giorni, lineup, stato = 'pubblicato', coordinate = true }) {
        const id = await inserisci('evento',
            `INSERT INTO evento (titolo, data_evento, ora_evento, luogo, citta,
                latitudine, longitudine, stato)
             VALUES (?, DATE_ADD(CURDATE(), INTERVAL ? DAY), '23:30:00',
                'Luogo fixture', 'Torino', ?, ?, ?)`,
            [titolo, giorni, coordinate ? 45.0703 : null, coordinate ? 7.6869 : null, stato]);
        for (const artistaId of lineup) {
            await db.query('INSERT INTO evento_artista (evento_id, artista_id) VALUES (?, ?)', [id, artistaId]);
        }
        return { id, titolo };
    }
    try {
        for (const lettera of ['A', 'B']) {
            const nome = `Fixture Pubblica ${lettera} ${suffisso}`;
            const id = await inserisci('artista', 'INSERT INTO artista (nome) VALUES (?)', [nome]);
            artisti.push({ id, nome });
        }
        for (const [artista, genere] of [[artisti[0], 'Techno'], [artisti[0], 'House'], [artisti[1], 'Trance']]) {
            const [[g]] = await db.query('SELECT id FROM genere WHERE nome = ?', [genere]);
            assert(g, 'GENERE_FIXTURE_MANCANTE');
            await db.query('INSERT INTO artista_genere (artista_id, genere_id) VALUES (?, ?)', [artista.id, g.id]);
        }
        if (utenteId !== undefined) {
            await db.query('INSERT INTO utente_artista (utente_id, artista_id) VALUES (?, ?)', [utenteId, artisti[0].id]);
        }
        if (completo) {
            for (const artista of artisti) {
                const titolo = `Brano ${artista.nome}`;
                const id = await inserisci('brano',
                    'INSERT INTO brano (titolo, artista_id, data_pubblicazione) VALUES (?, ?, CURDATE())',
                    [titolo, artista.id]);
                brani.push({ id, titolo });
            }
            for (const [indice, lineup] of [[0, [artisti[0].id]], [1, [artisti[1].id]],
                [2, artisti.map(a => a.id)], [3, [artisti[1].id]]]) {
                eventi.push(await aggiungiEvento({ titolo: `Evento ${indice} ${suffisso}`,
                    giorni: indice + 1, lineup, coordinate: indice !== 3 }));
            }
        }
        return { artisti, brani, eventi, aggiungiEvento, pulisci };
    } catch (errore) {
        await pulisci();
        throw errore;
    }
}

module.exports = { creaCatalogoPubblico };
