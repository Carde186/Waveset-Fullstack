const { normalizzaImmagini, selezionaImmagine } = require('./immagini');

// Stesso lock del worker: uno snapshot non può essere riscritto durante il
// backfill. Nessuna modifica a evento, lineup, stati o timestamp di sync.
async function backfillImmagini({ pool, client = null, ids = null, limite = 20, applica = false }) {
    if (!Number.isInteger(limite) || limite < 1 || limite > 100 || (ids !== null && (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id < 1)))) throw new Error('PARAMETRI_NON_VALIDI');
    const c = await pool.getConnection();
    let acquisito = false;
    try {
        const [[lock]] = await c.query("SELECT GET_LOCK(CONCAT(DATABASE(),':ticketmaster-sync'),0) acquisito");
        acquisito = lock.acquisito === 1;
        if (!acquisito) return { esito: 'occupato' };
        const [righe] = await c.query(`SELECT e.id,e.id_esterno,sf.snapshot FROM evento e
            JOIN ticketmaster_evento_fonte sf ON sf.evento_id=e.id
            WHERE e.fonte='ticketmaster' AND NOT JSON_CONTAINS_PATH(sf.snapshot,'one','$.immagine')
            ${ids ? 'AND e.id IN (?)' : ''} ORDER BY e.id LIMIT ?`, ids ? [ids, limite] : [limite]);
        const r = { esito: 'ok', applicato: applica, candidati: righe.map(e => e.id), aggiornati: 0, conImmagine: 0, senzaImmagine: 0, daRecuperare: 0, nonDisponibili: 0, errori: 0 };
        for (const e of righe) {
            let snapshot;
            try { snapshot = typeof e.snapshot === 'string' ? JSON.parse(e.snapshot) : e.snapshot; }
            catch { r.errori++; continue; }
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) { r.errori++; continue; }
            let images = snapshot.images;
            if (!Array.isArray(images)) {
                if (!client) { r.daRecuperare++; continue; }
                let raw;
                try { raw = await client.recuperaEvento(e.id_esterno); }
                catch { r.errori++; continue; }
                // Un 404 o ID inatteso non cancella dati e rimane ripetibile.
                if (!raw || raw.id !== e.id_esterno) { r.nonDisponibili++; continue; }
                images = raw.images;
            }
            const immagini = normalizzaImmagini(images), immagine = selezionaImmagine(immagini);
            if (immagine) r.conImmagine++; else r.senzaImmagine++;
            if (applica) {
                const [scritto] = await c.query(`UPDATE ticketmaster_evento_fonte
                    SET snapshot=JSON_SET(snapshot,'$.images',CAST(? AS JSON),'$.immagine',CAST(? AS JSON))
                    WHERE evento_id=? AND NOT JSON_CONTAINS_PATH(snapshot,'one','$.immagine')`,
                    [JSON.stringify(immagini), JSON.stringify(immagine), e.id]);
                r.aggiornati += scritto.affectedRows;
            }
        }
        return r;
    } finally {
        if (acquisito) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(),':ticketmaster-sync'))").catch(() => {});
        c.release();
    }
}
module.exports = { backfillImmagini };
