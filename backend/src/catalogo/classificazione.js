const classificazione = require('./classificazione.json');
// Tassonomia editoriale Waveset, distinta dai generi del provider.
// Solo aggiunte idempotenti: non sostituisce classificazioni già curate.
async function classifica(pool, applica = false) {
    const c = await pool.getConnection();
    try {
        await c.beginTransaction();
        const [artisti] = await c.query('SELECT id,nome FROM artista ORDER BY id');
        const [generi] = await c.query('SELECT id,nome FROM genere');
        const [relazioni] = await c.query('SELECT artista_id,genere_id FROM artista_genere');
        const esistenti = new Set(relazioni.map(r => `${r.artista_id}:${r.genere_id}`));
        const indice = new Map(generi.map(g => [g.nome, g.id]));
        const piano = [];
        for (const a of artisti) for (const nome of classificazione[a.nome] ?? []) {
            const id = indice.get(nome);
            if (!id) throw new Error('Genere editoriale assente: inizializzare lo schema catalogo');
            if (!esistenti.has(`${a.id}:${id}`)) piano.push({ artistaId: a.id, artista: a.nome, genereId: id, genere: nome });
        }
        if (applica) {
            for (const r of piano) await c.query('INSERT IGNORE INTO artista_genere(artista_id,genere_id) VALUES(?,?)', [r.artistaId, r.genereId]);
            await c.commit();
        } else await c.rollback();
        return { applicato: applica, artisti: artisti.filter(a => classificazione[a.nome]).length, nuoveAssociazioni: piano.length, piano };
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
module.exports = { classifica, classificazione };
