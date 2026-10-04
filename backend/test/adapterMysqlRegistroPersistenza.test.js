'use strict';
// MySQL reale: i servizi sono osservati e protetti, mai proprietà del registro.
const guardia = require('./preparaAmbiente');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
const { db, URL_API, verificaCanarina } = require('./aiuto');
const { creaRegistro } = require('./helpers/registroFixture');
const { creaAdapterMysqlRegistro } = require('./helpers/adapterMysqlRegistro');

test('MySQL registro: JSON, millisecondi e audit nullable preservati; pulizia e rollback sicuri', async t => {
    let artista, evento, link, temporaneo, adapter, pool;
    const tag = randomUUID();
    try {
        await verificaCanarina();
        const [a] = await db.query('INSERT INTO artista(nome) VALUES(?)', ['Fixture registro ' + tag]); artista = a.insertId;
        const [e] = await db.query("INSERT INTO evento(titolo,data_evento,luogo,citta) VALUES(?,'2090-01-01','Fixture','Roma')", ['Fixture registro ' + tag]); evento = e.insertId;
        await db.query("INSERT INTO ticketmaster_evento_fonte(evento_id,snapshot,ultimo_controllo) VALUES(?,?,'2090-01-01 12:00:00.123')", [evento, JSON.stringify({ tag, testo: 'è;: foto', valori: [null, ''] })]);
        await db.query("INSERT INTO ticketmaster_artista_sync(artista_id,ultimo_successo) VALUES(?,'2090-01-01 12:00:00.456')", [artista]);
        const [l] = await db.query("INSERT INTO artista_provider_link(artista_id,provider,external_id,storefront,url,dati_normalizzati_json,raw_json,sincronizzato_at) VALUES(?,'deezer',?,'','https://www.deezer.com/artist/1',?,'{}','2090-01-01 12:00:00.789')", [artista, tag, JSON.stringify({ name: tag })]); link = l.insertId;
        await db.query("INSERT INTO artista_ticketmaster_presenza(link_id,external_id,storefront,esito_json,controllato_at) VALUES(?,?,'','{}','2090-01-01 12:00:00.123')", [link, tag]);
        await db.query('INSERT INTO ollama_evento_job(evento_id) VALUES(?)', [evento]);
        await db.query("INSERT INTO ollama_evento_audit(evento_id,artista_id,generazione,tentativo,modello,versione_prompt,input_hash,input_json,risposta_raw,confidenza) VALUES(?,NULL,1,1,'fixture','fixture',?,'{}',?,0.98765)", [evento, '0'.repeat(64), JSON.stringify({ tag })]);
        pool = mysql.createPool({ host: process.env.DB_HOST, port: process.env.DB_PORT,
            user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: guardia.DB_TEST,
            connectionLimit: 1, dateStrings: true, decimalNumbers: false, timezone: 'Z',
            typeCast: true, rowsAsArray: false, multipleStatements: false, debug: false });
        adapter = await creaAdapterMysqlRegistro({ pool, guardia, urlApi: URL_API });
        const baseline = await adapter.acquisisciBaseline();
        const registro = creaRegistro(baseline);
        assert.equal(Object.keys(baseline).length, 19);
        assert(baseline.ollama_evento_audit.some(r => r.evento_id === evento && r.artista_id === null));
        await t.test('DELETE della sola PK registrata conserva tutti i servizi con dati non vuoti', async () => {
            const [a] = await db.query('INSERT INTO artista(nome) VALUES(?)', ['Temporaneo registro ' + tag]); temporaneo = a.insertId;
            registro.registraId('artista', a);
            const conteggi = await registro.pulisci(adapter);
            assert.equal(conteggi.artista, 1);
            assert.equal(Object.values(conteggi).reduce((a, b) => a + b, 0), 1);
            temporaneo = undefined;
            const [[audit]] = await db.query('SELECT risposta_raw,confidenza FROM ollama_evento_audit WHERE evento_id=?', [evento]);
            assert.equal(audit.risposta_raw, JSON.stringify({ tag }));
            assert.equal(audit.confidenza, '0.98765');
        });
        await t.test('un millisecondo diverso nello snapshot fonte blocca prima delle DELETE', async () => {
            await db.query("UPDATE ticketmaster_evento_fonte SET ultimo_controllo='2090-01-01 12:00:00.124' WHERE evento_id=?", [evento]);
            await assert.rejects(registro.pulisci(adapter), /STATO_SERVIZI_MODIFICATO/);
            const [[r]] = await db.query('SELECT COUNT(*) n FROM evento WHERE id=?', [evento]); assert.equal(r.n, 1);
        });
    } finally {
        try { await adapter?.chiudi(); } finally {
            try {
                if (temporaneo !== undefined) await db.query('DELETE FROM artista WHERE id=?', [temporaneo]);
                if (evento !== undefined) await db.query('DELETE FROM evento WHERE id=?', [evento]);
                if (artista !== undefined) await db.query('DELETE FROM artista WHERE id=?', [artista]);
            } finally { await pool?.end(); await db.end(); }
        }
    }
});
