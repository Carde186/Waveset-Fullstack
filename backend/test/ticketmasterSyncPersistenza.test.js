// DB reale waveset_test; fonte controllata. Un solo artista temporaneo,
// nessun utente/sessione/follow, pulizia esclusivamente degli ID creati qui.
require('./preparaAmbiente');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const pool = require('../src/config/database');
const { creaRepository, conBlocco } = require('../src/ticketmaster/repository');
const { sincronizza } = require('../src/ticketmaster/sincronizza');
const { normalizza } = require('../src/ticketmaster/normalizza');
const { configurazione } = require('../src/ticketmaster/configurazione');
const { statoPubblico } = require('../src/ticketmaster/stato');
const { SOLO_PUBBLICATI } = require('../src/utilita/eventi');

test('Ticketmaster: integrazione DB, idempotenza, modifiche, ADMIN, annullamenti e lock', async t => {
    const conn = await pool.getConnection();
    const tag = randomUUID(), idAttrazione = `test-${tag}`;
    let artista, server; const eventiCreati = [];
    const ora = new Date('2026-10-03T10:00:00Z');
    const raw = (suffisso, patch = {}) => ({ id: `test-${tag}-${suffisso}`, name: 'Concerto di test',
        dates: { start: { localDate: '2027-05-02', localTime: '21:00:00' }, status: { code: 'onsale' } },
        _embedded: { attractions: [{ id: idAttrazione, name: `Sync test ${tag}` }],
            venues: [{ name: 'Club test', city: { name: 'Milano' }, location: { latitude: '45', longitude: '9' } }] }, ...patch });
    const repo = creaRepository(conn);
    const salva = async (suffisso, patch = {}, confermato = true) => {
        const fonte = normalizza(raw(suffisso, patch), [{ ...artista, id_ticketmaster: confermato ? idAttrazione : null }]);
        const risultato = await repo.salva(fonte, ora);
        const [[riga]] = await conn.query('SELECT *,DATE_FORMAT(data_evento,"%Y-%m-%d") giorno FROM evento WHERE fonte="ticketmaster" AND id_esterno=?', [fonte.id_esterno]);
        if (riga && !eventiCreati.includes(riga.id)) eventiCreati.push(riga.id);
        return { risultato, riga };
    };
    const fonteDi = async id => (await conn.query('SELECT * FROM ticketmaster_evento_fonte WHERE evento_id=?', [id]))[0][0];
    try {
        const [[db]] = await conn.query('SELECT DATABASE() nome'); assert.equal(db.nome, 'waveset_test');
        const [[lock]] = await conn.query("SELECT GET_LOCK('waveset_test:ticketmaster-sync',0) acquisito");
        assert.equal(lock.acquisito, 1, 'fermare il worker prima del test DB');
        await conn.query("SET time_zone='+00:00'");
        const [creato] = await conn.query('INSERT INTO artista (nome,id_ticketmaster) VALUES (?,?)', [`Sync test ${tag}`, idAttrazione]);
        artista = { id: creato.insertId, nome: `Sync test ${tag}`, id_ticketmaster: idAttrazione };
        let principale;
        await t.test('nuovo evento confermato pubblicato; ripetizione non duplica righe o lineup', async () => {
            principale = (await salva('a')).riga;
            assert.equal(principale.stato, 'pubblicato');
            assert.equal((await salva('a')).riga.id, principale.id);
            const [[n]] = await conn.query('SELECT COUNT(*) n FROM evento_artista WHERE evento_id=?', [principale.id]);
            assert.equal(n.n, 1); assert.equal((await fonteDi(principale.id)).protetto_admin, 0);
        });
        await t.test('data e luogo modificati aggiornano campi non curati', async () => {
            const aggiornato = await salva('a', { name: 'Concerto aggiornato', dates: { start: { localDate: '2027-06-03' }, status: { code: 'rescheduled' } } });
            assert.equal(aggiornato.risultato, 'aggiornati'); assert.equal(aggiornato.riga.titolo, 'Concerto aggiornato');
            assert.equal(aggiornato.riga.giorno, '2027-06-03'); assert.equal((await fonteDi(principale.id)).modifiche_fonte, 0);
        });
        await t.test('modifica manuale rilevata anche senza flag: catalogo conservato e nuova fonte separata', async () => {
            await conn.query('UPDATE evento SET titolo=? WHERE id=?', ['Titolo curato ADMIN', principale.id]);
            const protetto = await salva('a'); assert.equal(protetto.risultato, 'protetti');
            assert.equal(protetto.riga.titolo, 'Titolo curato ADMIN');
            const fonte = await fonteDi(principale.id); assert.equal(fonte.protetto_admin, 1); assert.equal(fonte.modifiche_fonte, 1);
            assert.equal(fonte.snapshot.campi.titolo, 'Concerto di test');
        });
        await t.test('attraction confermata e lineup non vengono riscritte da un candidato diverso', async () => {
            await salva('a', { _embedded: { attractions: [{ id: 'altra-identita', name: artista.nome }] } });
            const [[link]] = await conn.query('SELECT id_attraction_ticketmaster FROM evento_artista WHERE evento_id=?', [principale.id]);
            assert.equal(link.id_attraction_ticketmaster, idAttrazione);
            const [[locale]] = await conn.query('SELECT id_ticketmaster FROM artista WHERE id=?', [artista.id]);
            assert.equal(locale.id_ticketmaster, idAttrazione);
            assert.equal((await fonteDi(principale.id)).modifiche_fonte, 1);
            await conn.query('UPDATE evento_artista SET id_attraction_ticketmaster=? WHERE evento_id=?', ['collegamento-curato', principale.id]);
            await salva('a');
            const [[curato]] = await conn.query('SELECT id_attraction_ticketmaster FROM evento_artista WHERE evento_id=?', [principale.id]);
            assert.equal(curato.id_attraction_ticketmaster, 'collegamento-curato'); assert.equal((await fonteDi(principale.id)).modifiche_fonte, 1);
        });
        await t.test('errore SQL durante la lineup annulla anche inserimento evento e snapshot', async () => {
            const fonte = normalizza(raw('rollback'), [artista]);
            fonte.lineup.push({ artista_id: 2147483647, id_attraction_ticketmaster: 'inesistente', confermato: true });
            await assert.rejects(() => repo.salva(fonte, ora), e => e.code === 'ER_NO_REFERENCED_ROW_2');
            const [[n]] = await conn.query('SELECT COUNT(*) n FROM evento WHERE fonte="ticketmaster" AND id_esterno=?', [fonte.id_esterno]); assert.equal(n.n, 0);
        });
        await t.test('annullamento esplicito escluso dalle query pubbliche senza riscrivere approvazione ADMIN', async () => {
            await salva('a', { dates: { start: { localDate: '2027-05-02' }, status: { code: 'canceled' } } });
            const [visibili] = await conn.query(`SELECT e.id FROM evento e WHERE e.id=? AND ${SOLO_PUBBLICATI}`, [principale.id]);
            assert.equal(visibili.length, 0);
            const [[core]] = await conn.query('SELECT stato,titolo FROM evento WHERE id=?', [principale.id]);
            assert.equal(core.stato, 'pubblicato'); assert.equal(core.titolo, 'Titolo curato ADMIN');
        });
        await t.test('evento protetto identico alla fonte non genera falsi avvisi per DECIMAL o ordine JSON', async () => {
            const identico = (await salva('identico')).riga;
            await conn.query('UPDATE ticketmaster_evento_fonte SET protetto_admin=TRUE WHERE evento_id=?', [identico.id]);
            assert.equal((await salva('identico')).risultato, 'protetti'); assert.equal((await fonteDi(identico.id)).modifiche_fonte, 0);
        });
        await t.test('assenza persistente e ricomparsa: nessuna cancellazione di catalogo', async () => {
            await repo.assente(principale.id, ora); const prima = (await fonteDi(principale.id)).assente_dal;
            await repo.assente(principale.id, new Date(ora.getTime() + 1000));
            assert.equal((await fonteDi(principale.id)).assente_dal.getTime(), prima.getTime());
            await salva('a'); assert.equal((await fonteDi(principale.id)).assente_dal, null);
        });
        await t.test('import legacy senza snapshot protetto anche quando la fonte restituisce 404', async () => {
            const [r] = await conn.query('INSERT INTO evento (titolo,data_evento,fonte,id_esterno) VALUES (?, ?,"ticketmaster",?)', ['Legacy curato', '2027-05-02', `test-${tag}-legacy`]);
            eventiCreati.push(r.insertId); await repo.assente(r.insertId, ora);
            const fonte = await fonteDi(r.insertId); assert.equal(fonte.protetto_admin, 1); assert.equal(fonte.ultimo_avvistamento, null); assert.ok(fonte.assente_dal);
        });
        // Router ADMIN reale montato senza autenticazione per testare solo SQL
        // e protezione dei campi; auth/ruoli restano coperti dai test preesistenti.
        const app = express(); app.use(express.json()); app.use('/admin', require('../src/routes/admin/eventi'));
        server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
        const url = `http://127.0.0.1:${server.address().port}/admin`;
        const richiesta = (id, action, body) => fetch(`${url}/${id}${action}`, { method: body ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        await t.test('candidato non confermato in coda; PATCH/approvazione ADMIN proteggono atomicamente', async () => {
            const candidato = (await salva('b', {}, false)).riga; assert.equal(candidato.stato, 'in_coda');
            assert.equal((await richiesta(candidato.id, '', { titolo: 'Corretto' })).status, 204);
            assert.equal((await richiesta(candidato.id, '/approva')).status, 204);
            assert.equal((await fonteDi(candidato.id)).protetto_admin, 1);
            const rispostaFonte = await fetch(`${url}/${candidato.id}/fonte`); assert.equal(rispostaFonte.status, 200);
            const fonteApi = await rispostaFonte.json(); assert.equal(fonteApi.protetto_admin, true); assert.equal(fonteApi.ultimo_controllo, '2026-10-03T10:00:00Z');
            const dopo = await salva('b', { name: 'Fonte diversa' }); assert.equal(dopo.riga.stato, 'pubblicato'); assert.equal(dopo.riga.titolo, 'Corretto');
        });
        await t.test('scarto ADMIN permanente: il sync non ripubblica', async () => {
            const candidato = (await salva('c', {}, false)).riga;
            assert.equal((await richiesta(candidato.id, '/scarta')).status, 204);
            assert.equal((await salva('c')).riga.stato, 'scartato'); assert.equal((await fonteDi(candidato.id)).protetto_admin, 1);
        });
        await t.test('secondo esecutore rifiutato dal GET_LOCK MySQL reale', async () => {
            assert.deepEqual(await conBlocco(pool, () => assert.fail('lock duplicato')), { esito: 'occupato' });
        });
        await t.test('ciclo completo con fonte simulata e DB reale: associazione locale e cache persistita', async () => {
            const repository = { ...repo, esitoCiclo: async () => {} }; // non cambiare lo stato globale del catalogo test
            const client = { cercaPagine: async () => ({ eventi: [raw('d')], completa: true }), recuperaEvento: async () => null, richieste: () => 1 };
            const config = configurazione({ TICKETMASTER_API_KEY: 'solo-fixture' });
            const r = await sincronizza({ repository, client, config, ids: [artista.id], forza: true, adesso: ora });
            const [[importato]] = await conn.query('SELECT id FROM evento WHERE id_esterno=? AND fonte="ticketmaster"', [`test-${tag}-d`]); eventiCreati.push(importato.id);
            assert.equal(r.artisti, 1); assert.equal(r.falliti, 0);
            const [[link]] = await conn.query('SELECT artista_id FROM evento_artista WHERE evento_id=?', [importato.id]); assert.equal(link.artista_id, artista.id);
            const [[progress]] = await conn.query('SELECT ultimo_successo,prossimo_tentativo FROM ticketmaster_artista_sync WHERE artista_id=?', [artista.id]); assert.ok(progress.ultimo_successo); assert.ok(progress.prossimo_tentativo);
        });
        await t.test('stato globale e timestamp UTC verificati in transazione poi rollback', async () => {
            await conn.beginTransaction();
            try {
                await repo.esitoCiclo(ora, { esito: 'ok', errore: null, richieste: 1, prossimo: null, fallimentiGlobali: 0 });
                const s = await statoPubblico(conn, { TICKETMASTER_API_KEY: 'solo-fixture' }, ora);
                assert.equal(s.ultimo_successo, '2026-10-03T10:00:00Z'); assert.equal(s.dati_vecchi, false);
            } finally { await conn.rollback(); }
        });
    } finally {
        if (server) await new Promise(r => server.close(r));
        if (eventiCreati.length) await conn.query('DELETE FROM evento WHERE id IN (?) AND fonte="ticketmaster" AND id_esterno LIKE ?', [eventiCreati, `test-${tag}-%`]);
        if (artista) await conn.query('DELETE FROM artista WHERE id=? AND nome=?', [artista.id, artista.nome]);
        await conn.query("SELECT RELEASE_LOCK('waveset_test:ticketmaster-sync')").catch(() => {});
        conn.release(); await pool.end();
    }
});
