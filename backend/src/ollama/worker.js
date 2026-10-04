const { applicaDecisione } = require('./decisione');
const { creaRepository } = require('./repository');
async function ciclo({ repository, client, config }) {
    await repository.riconcilia();
    const jobs = await repository.pronti();
    const riepilogo = { controllati: 0, approva: 0, rifiuta: 0, da_valutare: 0, obsoleto: 0 };
    if (!jobs.length) return riepilogo;
    let errorePronto;
    try { await client.pronto(); } catch (e) { errorePronto = e; }
    let cursore = 0, finalizzazione = Promise.resolve();
    async function esecutore() {
        while (cursore < jobs.length) {
            const j = jobs[cursore++];
            const inputs = await repository.input(j.evento_id);
            const job = await repository.prenota(j, inputs);
            if (!job) continue;
            const risultati = [];
            for (const input of inputs) {
                try {
                    if (job.interrotto) throw Object.assign(new Error(), { codice: 'OLLAMA_TENTATIVI_INTERROTTI', temporaneo: true });
                    if (errorePronto) throw errorePronto;
                    const { risposta, raw } = await client.valuta(input);
                    risultati.push({ ...applicaDecisione(input, risposta, config.soglia), risposta, raw });
                } catch (e) {
                    const temporaneo = e.temporaneo !== false;
                    risultati.push({ temporaneo, errore: e.codice ?? 'OLLAMA_ERRORE_TECNICO', raw: e.raw,
                        ...(temporaneo ? {} : { decisione: 'rifiuta', motivazione: 'Risposta Ollama assente o non conforme al contratto JSON.' }) });
                }
            }
            const applicazione = finalizzazione.then(() => repository.termina(job, inputs, risultati));
            finalizzazione = applicazione.catch(() => {});
            const stato = await applicazione;
            riepilogo.controllati++; riepilogo[stato]++;
        }
    }
    const esiti = await Promise.allSettled(Array.from({ length: Math.min(config.concorrenza, jobs.length) }, esecutore));
    const fallito = esiti.find(e => e.status === 'rejected');
    if (fallito) throw fallito.reason;
    return riepilogo;
}
async function esegui(pool, client, config, env = process.env) {
    const c = await pool.getConnection(); let lock = false;
    try {
        const [[r]] = await c.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':ollama-eventi'),0) acquisito");
        if (r.acquisito !== 1) return { esito: 'occupato' };
        lock = true;
        return await ciclo({ repository: creaRepository(pool, config, env), client, config });
    } finally {
        if (lock) await c.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':ollama-eventi'))").catch(() => {});
        c.release();
    }
}
module.exports = { ciclo, esegui };
