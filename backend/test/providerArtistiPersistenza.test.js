// HTTP Deezer/Ticketmaster simulato, fixture SQL temporanee isolate e ripulite.
require('./preparaAmbiente');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const pool = require('../src/config/database');
const { creaRepository } = require('../src/artistiProvider/repository');
const { creaService } = require('../src/artistiProvider/service');
const { formattaEventi } = require('../src/utilita/eventi');
test('Provider: migrazione idempotente, profili distinti, unicità e controlli Ticketmaster persistenti', async t => {
    const artisti = [], eventi = [], tag = randomUUID(), esterno = `8${Date.now()}`;
    const repository = creaRepository(pool, 'deezer');
    let guasto = false, nome = 'Artista test';
    const client = { async dettaglio(id) { return { provider: 'deezer', externalId: id, storefront: '', name: nome, fan: 123,
        url: `https://www.deezer.com/artist/${id}`, artwork: { url: 'https://cdn-images.dzcdn.net/immagine.jpg', width: 250, height: 250 },
        genres: [], raw: { id }, syncedAt: new Date().toISOString() }; } };
    const service = creaService({ provider: 'deezer', repository, client, controllaTicketmaster: async () => {
        if (guasto) throw new Error('Ticketmaster non disponibile');
        return { stato: 'trovato', attractions: [{ id: 'test-attraction', name: nome }], ambiguo: false, controllatoAt: new Date().toISOString() };
    } });
    const errore = codice => e => e.codice === codice;
    try {
        const [[db]] = await pool.query('SELECT DATABASE() nome'); assert.equal(db.nome, 'waveset_test');
        for (let i = 0; i < 2; i++) {
            const [r] = await pool.query('INSERT INTO artista (nome,bio,id_ticketmaster) VALUES (?,?,?)', [`Provider test ${tag}-${i}`, 'Bio ADMIN', `presenza-${tag}-${i}`]); artisti.push(r.insertId);
        }
        await t.test('CREATE ripetuto senza alterare righe o vincoli', async () => {
            for (let giro = 0; giro < 2; giro++) for (const file of ['14_apple_music_provider_schema.sql', '15_artista_ticketmaster_presenza_schema.sql']) {
                const sql = readFileSync(path.join(__dirname, '../db/init', file), 'utf8').replace(/^--.*$/gm, '').trim();
                assert(/^CREATE TABLE IF NOT EXISTS /i.test(sql)); await pool.query(sql);
            }
        });
        let link;
        await t.test('collegamento e presenza, raw isolato e ID Ticketmaster curato preservato', async () => {
            link = await service.collega(artisti[0], { external_id: esterno, versione_attesa: null });
            assert.equal(link.ticketmaster.stato, 'trovato'); assert.equal(link.fan, 123);
            const letto = await service.leggi(artisti[0]); assert.equal(letto.collegamento.ticketmaster.attractions[0].id, 'test-attraction');
            assert.equal(letto.collegamento.storefront, ''); assert.equal(Object.hasOwn(letto.collegamento, 'raw'), false);
            const [[r]] = await pool.query('SELECT id_ticketmaster FROM artista WHERE id=?', [artisti[0]]); assert.equal(r.id_ticketmaster, `presenza-${tag}-0`);
        });
        await t.test('profilo già occupato rifiutato, un solo link per artista/provider e provider ritirato non utilizzabile', async () => {
            await assert.rejects(service.collega(artisti[1], { external_id: esterno, versione_attesa: null }), errore('DEEZER_GIA_COLLEGATO'));
            assert.equal(await repository.leggi(artisti[1]), null);
            assert.equal((await repository.leggi(artisti[0])).externalId, esterno);
            assert.throws(() => creaRepository(pool, 'apple_music'), errore('PROVIDER_CONFIGURAZIONE'));
            await assert.rejects(pool.query("INSERT INTO artista_provider_link (artista_id,provider,external_id,storefront,url,dati_normalizzati_json,raw_json,sincronizzato_at) SELECT artista_id,provider,?,storefront,url,dati_normalizzati_json,raw_json,sincronizzato_at FROM artista_provider_link WHERE artista_id=? AND provider='deezer'", [`${esterno}9`, artisti[0]]), e => e.code === 'ER_DUP_ENTRY');
        });
        await t.test('sync conserva presenza; errore Ticketmaster non impedisce conferma e ricontrollo recupera', async () => {
            link = await service.sincronizza(artisti[0], { versione_attesa: 1 }); assert.equal(link.ticketmaster.stato, 'trovato');
            guasto = true;
            link = await service.collega(artisti[0], { external_id: `${esterno}1`, versione_attesa: 2 }); assert.equal(link.ticketmaster.stato, 'non_verificato');
            assert.equal((await service.leggi(artisti[0])).collegamento.ticketmaster.stato, 'non_verificato');
            guasto = false;
            link = await service.ricontrolla(artisti[0], { versione_attesa: 3 }); assert.equal(link.ticketmaster.stato, 'trovato'); assert.equal(link.versione, 3);
        });
        await t.test('controllo tardivo non sovrascrive profilo sostituito; cambio ID invalida presenza', async () => {
            const precedente = link;
            await repository.salva(artisti[0], await client.dettaglio(`${esterno}2`), 3);
            assert.equal((await repository.leggiPresenza(artisti[0])).controllatoAt, null);
            await assert.rejects(repository.salvaPresenza(artisti[0], precedente, precedente.ticketmaster), errore('DEEZER_CONFLITTO'));
            const corrente = await repository.leggi(artisti[0]);
            await repository.salvaPresenza(artisti[0], corrente, precedente.ticketmaster);
            assert.equal((await repository.leggiPresenza(artisti[0], precedente)).controllatoAt, null);
            await repository.salva(artisti[0], await client.dettaglio(`${esterno}1`), 4);
            assert.equal((await repository.leggiPresenza(artisti[0])).controllatoAt, null);
        });
        await t.test('due conferme concorrenti: una scrittura e un conflitto, niente duplicati', async () => {
            const esiti = await Promise.allSettled([
                service.collega(artisti[0], { external_id: `${esterno}3`, versione_attesa: 5 }),
                service.collega(artisti[0], { external_id: `${esterno}4`, versione_attesa: 5 }),
            ]);
            assert.equal(esiti.filter(e => e.status === 'fulfilled').length, 1);
            assert.equal(esiti.find(e => e.status === 'rejected').reason.codice, 'DEEZER_CONFLITTO');
            const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM artista_provider_link WHERE artista_id=? AND provider=?', [artisti[0], 'deezer']); assert.equal(n, 1);
        });
        await t.test('lineup/marker: foto del provider attivo con un solo artista per evento', async () => {
            const [e] = await pool.query('INSERT INTO evento (titolo,data_evento) VALUES (?,?)', [`Provider marker test ${tag}`, '2099-01-01']); eventi.push(e.insertId);
            await pool.query('INSERT INTO evento_artista (evento_id,artista_id) VALUES (?,?)', [e.insertId, artisti[0]]);
            const [r] = await formattaEventi([{ id: e.insertId, latitudine: null, longitudine: null }]);
            assert.equal(r.lineup.length, 1); assert.equal(r.lineup[0].immagine_url, 'https://cdn-images.dzcdn.net/immagine.jpg');
        });
    } finally {
        if (eventi.length) await pool.query('DELETE FROM evento WHERE id IN (?)', [eventi]);
        if (artisti.length) await pool.query('DELETE FROM artista WHERE id IN (?)', [artisti]);
        await pool.end();
    }
});
