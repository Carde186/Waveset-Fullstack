// Solo waveset_test, fixture Test B esistente. Nessun nuovo utente/evento.
// La canarina di aiuto.js verifica che HTTP e SQL usino lo stesso DB.
const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { db, UTENTE_B, chiama, accedi, chiudi } = require('./aiuto');
let sessione, utenteId, iniziale, artistaId;
const creati = new Set();
before(async () => {
    const [[u]] = await db.query('SELECT id FROM utente WHERE email = ? AND ruolo = ?', [UTENTE_B.email, 'USER']);
    assert(u, 'Fixture Test B mancante');
    utenteId = u.id;
    [iniziale] = await db.query('SELECT artista_id FROM utente_artista WHERE utente_id = ? ORDER BY artista_id', [utenteId]);
    assert.equal(iniziale.length, 0, 'Test B contiene follow: fermarsi senza rimuoverli');
    const tutti = await chiama('/eventi?filtro=tutti');
    // Preferire un artista secondario per provare che conta tutta la lineup.
    const candidato = tutti.dati.find(e => e.lineup.length > 1)?.lineup[1] ?? tutti.dati[0]?.lineup[0];
    assert(candidato, 'Nessun artista con evento futuro disponibile per la prova');
    artistaId = candidato.id;
    sessione = await accedi(UTENTE_B);
});
after(async () => {
    try {
        if (sessione) for (const id of creati) {
            assert.equal((await chiama(`/artisti/${id}/segui`, { metodo: 'DELETE', sessione })).stato, 204);
        }
        if (iniziale) {
            const [finale] = await db.query('SELECT artista_id FROM utente_artista WHERE utente_id = ? ORDER BY artista_id', [utenteId]);
            assert.deepEqual(finale, iniziale, 'Follow iniziali non ripristinati');
        }
    } finally { await chiudi(); }
});
test('follow reale persistito, duplicato, eventi della lineup e unfollow idempotente', async () => {
    assert.deepEqual((await chiama('/eventi?filtro=seguiti', { sessione })).dati, []);
    creati.add(artistaId); // La coppia era assente prima del test, anche in caso di risposta persa.
    for (let i = 0; i < 2; i++) assert.equal((await chiama(`/artisti/${artistaId}/segui`, { metodo: 'PUT', sessione })).stato, 204);
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM utente_artista WHERE utente_id = ? AND artista_id = ?', [utenteId, artistaId]);
    assert.equal(n, 1);
    assert.equal((await chiama(`/artisti/${artistaId}`, { sessione })).dati.seguito, true);
    const tutti = (await chiama('/eventi?filtro=tutti')).dati;
    const seguiti = (await chiama('/eventi?filtro=seguiti', { sessione })).dati;
    const attesi = tutti.filter(e => e.lineup.some(a => a.id === artistaId)).map(e => e.id);
    assert(attesi.length > 0);
    assert.deepEqual(seguiti.map(e => e.id), attesi);
    assert.equal(new Set(seguiti.map(e => e.id)).size, seguiti.length);
    for (let i = 0; i < 2; i++) assert.equal((await chiama(`/artisti/${artistaId}/segui`, { metodo: 'DELETE', sessione })).stato, 204);
    assert.equal((await chiama(`/artisti/${artistaId}`, { sessione })).dati.seguito, false);
    assert.deepEqual((await chiama('/eventi?filtro=seguiti', { sessione })).dati, []);
    const [[{ restanti }]] = await db.query('SELECT COUNT(*) AS restanti FROM utente_artista WHERE utente_id = ? AND artista_id = ?', [utenteId, artistaId]);
    assert.equal(restanti, 0);
});
