const { preparaInput, hash } = require('./input');
const { VERSIONE_PROMPT } = require('./prompt');
function creaRepository(pool, config, env = process.env) {
    const input = id => preparaInput(pool, id, env);
    async function transazione(f) {
        const c = await pool.getConnection();
        try { await c.beginTransaction(); const r = await f(c); await c.commit(); return r; }
        catch (e) { await c.rollback(); throw e; } finally { c.release(); }
    }
    const pendente = async (c, id) => {
        await c.query("UPDATE evento SET stato='da_valutare' WHERE id=? AND fonte='ticketmaster'", [id]);
        await c.query(`UPDATE ticketmaster_evento_fonte SET campi_applicati=JSON_SET(campi_applicati,'$.stato','da_valutare') WHERE evento_id=? AND protetto_admin=FALSE AND campi_applicati IS NOT NULL`, [id]);
    };
    return {
        input,
        async riconcilia() {
            const [eventi] = await pool.query("SELECT id FROM evento WHERE fonte='ticketmaster' ORDER BY id");
            for (const { id } of eventi) {
                const inputs = await input(id);
                const impronta = hash(inputs, config.modello);
                await transazione(async c => {
                    await c.query('SELECT id FROM evento WHERE id=? FOR UPDATE', [id]);
                    await c.query(`INSERT IGNORE INTO ollama_evento_job(evento_id,stato_precedente,motivo_precedente)
                        SELECT id,stato,motivo_revisione FROM evento WHERE id=?`, [id]);
                    const [[j]] = await c.query('SELECT * FROM ollama_evento_job WHERE evento_id=? FOR UPDATE', [id]);
                    if (!j.input_hash) await c.query('UPDATE ollama_evento_job SET input_hash=? WHERE evento_id=?', [impronta, id]);
                    else if (j.input_hash !== impronta) await c.query(`UPDATE ollama_evento_job SET input_hash=?,generazione=generazione+1,
                        stato='da_valutare',tentativi=0,prossimo_tentativo=UTC_TIMESTAMP(3),errore=NULL,motivazione=NULL,valutato_at=NULL WHERE evento_id=?`, [impronta, id]);
                    if (!j.input_hash || j.input_hash !== impronta || j.stato === 'da_valutare') await pendente(c, id);
                });
            }
        },
        async pronti() {
            const [righe] = await pool.query(`SELECT * FROM ollama_evento_job WHERE stato='da_valutare'
                AND prossimo_tentativo<=UTC_TIMESTAMP(3) ORDER BY prossimo_tentativo,evento_id LIMIT ?`, [config.lotto]);
            return righe;
        },
        async prenota(job, inputs) {
            return transazione(async c => {
                await c.query('SELECT id FROM evento WHERE id=? FOR UPDATE', [job.evento_id]);
                const [[j]] = await c.query('SELECT * FROM ollama_evento_job WHERE evento_id=? FOR UPDATE', [job.evento_id]);
                if (!j || j.stato !== 'da_valutare' || j.generazione !== job.generazione || j.input_hash !== hash(inputs, config.modello)) return null;
                // Tentativo prenotato prima della rete. Un crash non azzera il contatore.
                if (j.tentativi >= config.tentativi) {
                    const [audit] = await c.query('SELECT id FROM ollama_evento_audit WHERE evento_id=? AND generazione=? AND tentativo=? ORDER BY id', [job.evento_id, j.generazione, j.tentativi]);
                    return { ...j, auditIds: audit.map(r => r.id), interrotto: true };
                }
                const numero = j.tentativi + 1;
                await c.query(`UPDATE ollama_evento_audit SET errore='OLLAMA_TENTATIVO_INTERROTTO',completato_at=UTC_TIMESTAMP(3)
                    WHERE evento_id=? AND generazione=? AND completato_at IS NULL`, [job.evento_id, j.generazione]);
                const ids = [];
                for (const v of inputs) {
                    const [r] = await c.query(`INSERT INTO ollama_evento_audit
                        (evento_id,artista_id,generazione,tentativo,modello,versione_prompt,input_hash,input_json)
                        VALUES(?,?,?,?,?,?,?,?)`, [job.evento_id, v.artista.id, j.generazione, numero, config.modello, VERSIONE_PROMPT, hash([v], config.modello), JSON.stringify(v)]);
                    ids.push(r.insertId);
                }
                await c.query('UPDATE ollama_evento_job SET tentativi=?,prossimo_tentativo=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND) WHERE evento_id=?',
                    [numero, Math.ceil(config.timeout / 1000) * Math.max(1, inputs.length) + 120, job.evento_id]);
                return { ...j, tentativi: numero, auditIds: ids, interrotto: j.tentativi >= config.tentativi };
            });
        },
        async termina(job, inputs, risultati) {
            return transazione(async c => {
                await c.query('SELECT id FROM evento WHERE id=? FOR UPDATE', [job.evento_id]);
                const [[j]] = await c.query('SELECT * FROM ollama_evento_job WHERE evento_id=? FOR UPDATE', [job.evento_id]);
                const attuali = await preparaInput(c, job.evento_id, env);
                if (j.generazione !== job.generazione || j.tentativi !== job.tentativi || j.stato !== 'da_valutare' || hash(attuali, config.modello) !== hash(inputs, config.modello)) {
                    for (let i = 0; i < job.auditIds.length; i++) {
                        const r = risultati[i];
                        await c.query(`UPDATE ollama_evento_audit SET risposta_raw=?,decisione_modello=?,confidenza=?,
                            motivazione='Valutazione non applicata: input o generazione cambiati.',errore='OLLAMA_INPUT_CAMBIATO',
                            decisione_applicata='da_valutare',completato_at=UTC_TIMESTAMP(3) WHERE id=?`,
                            [r?.raw?.slice(0, 60000) ?? null,r?.risposta?.decisione ?? null,r?.risposta?.confidenza ?? null,job.auditIds[i]]);
                    }
                    return 'obsoleto';
                }
                // La finalizzazione è serializzata dal worker sotto il lock globale.
                // Rileggere i duplicati evita che due inferenze parallele pubblichino lo stesso evento.
                const doppio = attuali.some(v => v.eventiRilevanti.length);
                const definitivo = risultati.find(r => r.decisione === 'rifiuta');
                const temporaneo = risultati.find(r => r.temporaneo);
                let stato = definitivo || doppio ? 'rifiuta' : temporaneo ? job.tentativi < config.tentativi ? 'da_valutare' : 'rifiuta' : 'approva';
                const motivo = doppio ? 'Possibile duplicato: stessa data e luogo.' : definitivo?.motivazione ?? (temporaneo ?
                    stato === 'rifiuta' ? 'Validazione tecnica non disponibile: tentativi esauriti.' : 'Validazione temporaneamente non disponibile: nuovo tentativo programmato.' : risultati.map(r => r.motivazione).join(' / ').slice(0, 400));
                const errore = risultati.find(r => r.errore)?.errore ?? null;
                for (let i = 0; i < risultati.length; i++) {
                    const r = risultati[i];
                    await c.query(`UPDATE ollama_evento_audit SET risposta_raw=?,decisione_modello=?,confidenza=?,motivazione=?,errore=?,
                        decisione_applicata=?,completato_at=UTC_TIMESTAMP(3) WHERE id=?`,
                        [r.raw?.slice(0, 60000) ?? null, r.risposta?.decisione ?? null, r.risposta?.confidenza ?? null,
                            r.motivazione ?? motivo, r.errore ?? null, stato, job.auditIds[i]]);
                }
                await c.query(`UPDATE ollama_evento_job SET stato=?,motivazione=?,errore=?,valutato_at=IF(?='da_valutare',NULL,UTC_TIMESTAMP(3)),
                    prossimo_tentativo=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND) WHERE evento_id=?`,
                    [stato, motivo, errore, stato, Math.min(3600, 60 * 2 ** (job.tentativi - 1)), job.evento_id]);
                const statoEvento = { approva: 'pubblicato', rifiuta: 'scartato', da_valutare: 'da_valutare' }[stato];
                await c.query('UPDATE evento SET stato=?,motivo_revisione=? WHERE id=?', [statoEvento, motivo.slice(0, 255), job.evento_id]);
                await c.query(`UPDATE ticketmaster_evento_fonte SET campi_applicati=JSON_SET(campi_applicati,'$.stato',?,'$.motivo_revisione',?)
                    WHERE evento_id=? AND protetto_admin=FALSE AND campi_applicati IS NOT NULL`, [statoEvento, motivo.slice(0, 255), job.evento_id]);
                return stato;
            });
        },
    };
}
async function rivaluta(pool, id) {
    const c = await pool.getConnection();
    try {
        await c.beginTransaction();
        const [[e]] = await c.query("SELECT id FROM evento WHERE id=? AND fonte='ticketmaster' FOR UPDATE", [id]);
        if (!e) { await c.rollback(); return false; }
        await c.query('INSERT IGNORE INTO ollama_evento_job(evento_id) VALUES(?)', [id]);
        // Ripetere la richiesta durante un job pendente non riavvia i tentativi.
        await c.query(`UPDATE ollama_evento_job SET generazione=generazione+1,stato='da_valutare',tentativi=0,
            prossimo_tentativo=UTC_TIMESTAMP(3),motivazione=NULL,errore=NULL,valutato_at=NULL WHERE evento_id=? AND stato<>'da_valutare'`, [id]);
        await c.query("UPDATE evento SET stato='da_valutare' WHERE id=?", [id]);
        await c.query(`UPDATE ticketmaster_evento_fonte SET campi_applicati=JSON_SET(campi_applicati,'$.stato','da_valutare')
            WHERE evento_id=? AND protetto_admin=FALSE AND campi_applicati IS NOT NULL`, [id]);
        await c.commit(); return true;
    } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
module.exports = { creaRepository, rivaluta };
