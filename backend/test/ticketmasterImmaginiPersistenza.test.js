// Solo waveset_test: evento temporaneo, artista esistente, nessun account o
// follow; chiamate Ticketmaster simulate, pulizia del solo ID creato dal test.
require('./preparaAmbiente');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const pool = require('../src/config/database');
const { creaRepository } = require('../src/ticketmaster/repository');
const { normalizza } = require('../src/ticketmaster/normalizza');
const { backfillImmagini } = require('../src/ticketmaster/backfillImmagini');
const { COLONNE_EVENTO, formattaEventi } = require('../src/utilita/eventi');

test('MySQL: copertina persistita, API lista/dettaglio, backfill idempotente e snapshot/ADMIN conservati', async () => {
    const c = await pool.getConnection(); let id;
    try {
        const [[db]] = await c.query('SELECT DATABASE() nome'); assert.equal(db.nome, 'waveset_test');
        const [[a]] = await c.query('SELECT id,nome FROM artista ORDER BY id LIMIT 1'); assert(a);
        const tag = randomUUID();
        const immagine = { url: 'https://s1.ticketm.net/dam/a/fixture-cover.jpg', width: 1024, height: 576, fallback: false };
        const raw = { id: `test-${tag}`, name: `Copertina test ${tag}`, images: [immagine],
            dates: { start: { localDate: '2090-01-01' }, status: { code: 'onsale' } },
            _embedded: { attractions: [{ id: 'attr-fixture', name: a.nome }], venues: [{ name: tag, city: { name: 'Test' }, location: { latitude: '45', longitude: '9' } }] } };
        const fonte = normalizza(raw, [{ ...a, id_ticketmaster: 'attr-fixture' }]);
        const repo = creaRepository(c);
        await repo.salva(fonte, new Date('2026-10-04T10:00:00Z'));
        const [[e]] = await c.query('SELECT * FROM evento WHERE id_esterno=?', [raw.id]); id = e.id;
        assert.equal((await c.query('SELECT snapshot FROM ticketmaster_evento_fonte WHERE evento_id=?', [id]))[0][0].snapshot.immagine.url, immagine.url);
        for (const where of ['e.id=?', 'e.id IN (?)']) {
            const [righe] = await c.query(`SELECT ${COLONNE_EVENTO} FROM evento e WHERE ${where}`, [id]);
            const [pubblico] = await formattaEventi(righe);
            assert.equal(pubblico.immagine_url, immagine.url); assert.equal(pubblico.immagine.source, 'ticketmaster');
            assert(!Object.hasOwn(pubblico, 'snapshot'));
        }
        // Simula snapshot precedente alla nuova normalizzazione; cura ADMIN.
        await c.query('UPDATE evento SET titolo=? WHERE id=?', ['Titolo ADMIN protetto', id]);
        await c.query(`UPDATE ticketmaster_evento_fonte SET snapshot=JSON_REMOVE(snapshot,'$.images','$.immagine'),protetto_admin=TRUE WHERE evento_id=?`, [id]);
        const [[prima]] = await c.query('SELECT * FROM ticketmaster_evento_fonte WHERE evento_id=?', [id]);
        const [[curato]] = await c.query('SELECT * FROM evento WHERE id=?', [id]);
        let richieste = 0;
        const client = { recuperaEvento: async esterno => { richieste++; assert.equal(esterno, raw.id); return raw; } };
        assert.equal((await backfillImmagini({ pool, client, ids: [id], limite: 1, applica: true })).aggiornati, 1);
        const [[dopo]] = await c.query('SELECT * FROM ticketmaster_evento_fonte WHERE evento_id=?', [id]);
        assert.deepEqual(dopo, { ...prima, snapshot: { ...prima.snapshot, images: fonte.images, immagine: fonte.immagine } });
        assert.deepEqual((await c.query('SELECT * FROM evento WHERE id=?', [id]))[0][0], curato);
        assert.equal((await backfillImmagini({ pool, client, ids: [id], limite: 1, applica: true })).aggiornati, 0); assert.equal(richieste, 1);
        // Un sync successivo aggiorna la cover anche su dati protetti ADMIN.
        const nuova = normalizza({ ...raw, images: [{ ...immagine, url: 'https://s1.ticketm.net/dam/a/nuova-cover.jpg' }] }, [{ ...a, id_ticketmaster: 'attr-fixture' }]);
        await repo.salva(nuova, new Date('2026-10-04T11:00:00Z'));
        assert.equal((await c.query('SELECT titolo FROM evento WHERE id=?', [id]))[0][0].titolo, curato.titolo);
        assert.equal((await c.query('SELECT snapshot FROM ticketmaster_evento_fonte WHERE evento_id=?', [id]))[0][0].snapshot.immagine.url, nuova.immagine.url);
        await repo.salva(normalizza({ ...raw, images: [] }, [{ ...a, id_ticketmaster: 'attr-fixture' }]), new Date('2026-10-04T12:00:00Z'));
        const [senza] = await c.query(`SELECT ${COLONNE_EVENTO} FROM evento e WHERE e.id=?`, [id]);
        assert.equal((await formattaEventi(senza))[0].immagine_url, null);
    } finally {
        if (id) await c.query('DELETE FROM evento WHERE id=?', [id]);
        c.release(); await pool.end();
    }
});
