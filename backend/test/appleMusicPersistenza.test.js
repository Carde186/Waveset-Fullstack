// Solo waveset_test, Apple HTTP simulato; nessun utente/sessione/follow creato.
require('./preparaAmbiente');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const pool = require('../src/config/database');
const { creaRepository } = require('../src/appleMusic/repository');
const { creaService } = require('../src/appleMusic/service');
const { creaClient } = require('../src/appleMusic/client');
const { ErroreAppleMusic } = require('../src/appleMusic/errore');

test('Apple Music: persistenza SQL, unicità, concorrenza, sostituzione atomica e sync', async t => {
    const ids = [], tag = randomUUID();
    const chiavi = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const env = { APPLE_MUSIC_TEAM_ID: 'TESTTEAM01', APPLE_MUSIC_KEY_ID: 'TESTKEY001', APPLE_MUSIC_STOREFRONT: 'it',
        APPLE_MUSIC_PRIVATE_KEY: chiavi.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
    // ID numerici temporanei indipendenti dal catalogo reale Apple.
    const primo = `9${Date.now()}${Math.floor(Math.random() * 100000)}`;
    const secondo = `${primo}1`, terzo = `${primo}2`;
    let guasto = false, nome = 'Profilo Apple test'; const chiamate = [];
    const client = creaClient({ env, attendi: async () => {}, fetchImpl: async url => {
        chiamate.push(url);
        if (guasto) return new Response('{}', { status: 503 });
        const u = new URL(url), id = u.pathname.split('/').at(-1);
        return new Response(JSON.stringify({ data: [{ id, type: 'artists', attributes: {
            name: nome, url: `https://music.apple.com/it/artist/test/${id}`, genreNames: ['Electronic'],
        } }] }));
    } });
    const repository = creaRepository(pool), service = creaService({ repository, client });
    const fallisce = code => e => e instanceof ErroreAppleMusic && e.codice === code;
    try {
        const [[db]] = await pool.query('SELECT DATABASE() nome'); assert.equal(db.nome, 'waveset_test');
        for (let i = 0; i < 2; i++) {
            const [r] = await pool.query('INSERT INTO artista (nome,bio,id_ticketmaster) VALUES (?,?,?)', [`Apple test ${tag}-${i}`, 'Bio locale curata', `apple-test-${tag}-${i}`]);
            ids.push(r.insertId);
        }
        await t.test('primo collegamento persistito; raw separato, nessun segreto nel profilo pubblico', async () => {
            const link = await service.collega(ids[0], { external_id: primo, versione_attesa: null }); assert.equal(link.versione, 1);
            const letto = await service.leggi(ids[0]); assert.equal(letto.collegamento.externalId, primo);
            assert.equal(Object.hasOwn(letto.collegamento, 'raw'), false);
            const [[r]] = await pool.query('SELECT * FROM artista_provider_link WHERE artista_id=?', [ids[0]]);
            assert.equal(r.provider, 'apple_music'); assert.equal(r.raw_json.id, primo); assert.equal(r.dati_normalizzati_json.name, nome);
            assert(!JSON.stringify(r).includes('BEGIN PRIVATE KEY')); assert(!JSON.stringify(r).includes('TESTTEAM01'));
        });
        await t.test('stesso profilo su altro artista bloccato; rollback completo', async () => {
            await assert.rejects(() => service.collega(ids[1], { external_id: primo, versione_attesa: null }), fallisce('APPLE_GIA_COLLEGATO'));
            assert.equal(await repository.leggi(ids[1]), null);
            assert.equal((await repository.leggi(ids[0])).versione, 1);
        });
        await t.test('versione non attesa non sostituisce; sostituzione confermata conserva una sola riga', async () => {
            await assert.rejects(() => service.collega(ids[0], { external_id: secondo, versione_attesa: null }), fallisce('APPLE_CONFLITTO'));
            await service.collega(ids[0], { external_id: secondo, versione_attesa: 1 });
            const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM artista_provider_link WHERE artista_id=?', [ids[0]]); assert.equal(n, 1);
            assert.equal((await repository.leggi(ids[0])).externalId, secondo);
            await service.collega(ids[1], { external_id: primo, versione_attesa: null });
        });
        await t.test('sostituzione verso identità occupata fallisce e conserva il link precedente', async () => {
            await assert.rejects(() => service.collega(ids[0], { external_id: primo, versione_attesa: 2 }), fallisce('APPLE_GIA_COLLEGATO'));
            assert.equal((await repository.leggi(ids[0])).externalId, secondo); assert.equal((await repository.leggi(ids[0])).versione, 2);
        });
        await t.test('errore Apple lascia ultimo snapshot; sync aggiorna solo profilo provider', async () => {
            guasto = true;
            await assert.rejects(() => service.sincronizza(ids[0], { versione_attesa: 2 }), fallisce('APPLE_TEMPORANEO'));
            assert.equal((await repository.leggi(ids[0])).versione, 2);
            guasto = false; nome = 'Nome pubblico aggiornato';
            const link = await service.sincronizza(ids[0], { versione_attesa: 2 });
            assert.equal(link.versione, 3); assert.equal(link.name, nome);
            assert(chiamate.at(-1).includes(`/catalog/it/artists/${secondo}`));
            const [[locale]] = await pool.query('SELECT nome,bio,id_ticketmaster FROM artista WHERE id=?', [ids[0]]);
            assert.equal(locale.nome, `Apple test ${tag}-0`); assert.equal(locale.bio, 'Bio locale curata');
            assert.equal(locale.id_ticketmaster, `apple-test-${tag}-0`);
        });
        await t.test('due conferme concorrenti della stessa versione: un successo e un conflitto', async () => {
            const esiti = await Promise.allSettled([
                service.collega(ids[0], { external_id: terzo, versione_attesa: 3 }),
                service.collega(ids[0], { external_id: secondo, versione_attesa: 3 }),
            ]);
            assert.equal(esiti.filter(e => e.status === 'fulfilled').length, 1);
            const rifiutato = esiti.find(e => e.status === 'rejected'); assert.equal(rifiutato.reason.codice, 'APPLE_CONFLITTO');
            assert.equal((await repository.leggi(ids[0])).versione, 4);
        });
        await t.test('vincoli SQL impediscono duplicato artista/provider anche fuori dal service', async () => {
            await assert.rejects(() => pool.query("INSERT INTO artista_provider_link (artista_id,provider,external_id,storefront,url,dati_normalizzati_json,raw_json,sincronizzato_at) SELECT artista_id,provider,?,storefront,url,dati_normalizzati_json,raw_json,sincronizzato_at FROM artista_provider_link WHERE artista_id=?", [`${primo}99`, ids[0]]), e => e.code === 'ER_DUP_ENTRY');
            await assert.rejects(() => service.leggi(2147483647), fallisce('ARTISTA_NON_TROVATO'));
        });
    } finally {
        if (ids.length) {
            // Pulizia limitata ai due artisti temporanei: CASCADE sui soli loro link.
            await pool.query('DELETE FROM artista WHERE id IN (?)', [ids]);
        }
        await pool.end();
    }
});
