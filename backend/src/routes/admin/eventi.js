const express = require('express');
const pool = require('../../config/database');
const { rivaluta } = require('../../ollama/repository');
const router = express.Router();
router.param('id', (req, res, next, v) => {
    if (!/^[1-9]\d*$/.test(v) || Number(v) > 2147483647) return res.status(400).json({ messaggio: 'ID non valido' });
    next();
});
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
async function leggi(id) {
    const [eventi] = await pool.query(`SELECT e.*,DATE_FORMAT(e.data_evento,'%Y-%m-%d') data_evento,
        j.stato decisione_finale,j.tentativi,j.motivazione,j.errore,DATE_FORMAT(j.valutato_at,'%Y-%m-%dT%H:%i:%sZ') valutato_at,
        j.generazione FROM evento e LEFT JOIN ollama_evento_job j ON j.evento_id=e.id
        WHERE e.fonte='ticketmaster' ${id ? 'AND e.id=?' : ''} ORDER BY e.data_evento,e.id`, id ? [id] : []);
    if (!eventi.length) return [];
    const ids = eventi.map(e => e.id);
    const [lineup] = await pool.query(`SELECT ea.evento_id,a.id,a.nome,a.id_ticketmaster,ea.id_attraction_ticketmaster
        FROM evento_artista ea JOIN artista a ON a.id=ea.artista_id WHERE ea.evento_id IN (?) ORDER BY a.nome`, [ids]);
    const [audit] = await pool.query(`SELECT id,evento_id,artista_id,generazione,tentativo,modello,versione_prompt,decisione_modello,
        confidenza,motivazione,errore,decisione_applicata,DATE_FORMAT(iniziato_at,'%Y-%m-%dT%H:%i:%sZ') iniziato_at,
        DATE_FORMAT(completato_at,'%Y-%m-%dT%H:%i:%sZ') completato_at ${id ? ',input_json,risposta_raw,input_hash' : ''}
        FROM ollama_evento_audit WHERE evento_id IN (?) ORDER BY id DESC`, [ids]);
    return eventi.map(e => {
        const storico = audit.filter(a => a.evento_id === e.id).map(a => ({ ...a, confidenza: a.confidenza === null ? null : Number(a.confidenza) }));
        const correnti = storico.filter(a => a.generazione === e.generazione && a.tentativo === e.tentativi);
        return { ...e, latitudine: e.latitudine === null ? null : Number(e.latitudine), longitudine: e.longitudine === null ? null : Number(e.longitudine),
            lineup: lineup.filter(a => a.evento_id === e.id).map(a => ({ ...a, collegamento_da_confermare: false })),
            valutazione: { decisione: e.decisione_finale ?? 'da_valutare', tentativi: e.tentativi ?? 0,
                motivazione: e.motivazione ?? null, errore: e.errore ?? null, data: e.valutato_at,
                modello: correnti[0]?.modello ?? null,
                confidenza: correnti.length && correnti.every(a => a.confidenza !== null) ? Math.min(...correnti.map(a => a.confidenza)) : null },
            audit: id ? storico : [] };
    });
}
async function registro(req, res) { res.json(await leggi()); }
async function dettaglio(req, res) {
    const [e] = await leggi(req.params.id);
    if (!e) return res.status(404).json({ messaggio: 'Evento non trovato' });
    res.json(e);
}
router.get('/registro', registro);
router.get('/coda', registro); // Alias di lettura per client precedenti; nessuna coda manuale.
router.get('/coda/:id', dettaglio);
router.get('/:id', dettaglio);
router.get('/:id/fonte', async (req, res) => {
    const [r] = await pool.query("SELECT snapshot,stato_fonte,protetto_admin,modifiche_fonte,DATE_FORMAT(ultimo_controllo,'%Y-%m-%dT%H:%i:%sZ') ultimo_controllo,DATE_FORMAT(assente_dal,'%Y-%m-%dT%H:%i:%sZ') assente_dal FROM ticketmaster_evento_fonte WHERE evento_id=?", [req.params.id]);
    if (!r.length) return res.status(404).json({ messaggio: 'Fonte evento non disponibile' });
    res.json({ ...r[0], protetto_admin: Boolean(r[0].protetto_admin), modifiche_fonte: Boolean(r[0].modifiche_fonte) });
});
router.post('/:id/rivaluta', async (req, res) => {
    if (!await rivaluta(pool, req.params.id)) return res.status(404).json({ messaggio: 'Evento Ticketmaster non trovato' });
    res.status(202).json({ evento_id: Number(req.params.id), stato: 'da_valutare' });
});
// Nessun percorso di scrittura legacy può aggirare la decisione automatica.
const manualeDisabilitato = (req, res) => res.status(410).json({ messaggio: 'Revisione manuale disabilitata: usare rivaluta con Ollama' });
router.patch('/:id', manualeDisabilitato);
router.post('/:id/approva', manualeDisabilitato);
router.post('/:id/scarta', manualeDisabilitato);
router.post('/:id/rifiuta', manualeDisabilitato);
router.post('/:id/artisti/:artistaId/conferma-collegamento', manualeDisabilitato);
router.use((errore, req, res, next) => next(new Error('Registro eventi non disponibile')));
module.exports = router;
