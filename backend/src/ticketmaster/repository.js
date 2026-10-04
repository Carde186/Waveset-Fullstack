const CAMPI = ['titolo', 'data_evento', 'ora_evento', 'luogo', 'citta', 'latitudine', 'longitudine'];
const sqlData = d => d.toISOString().slice(0, 23).replace('T', ' ');
const json = v => typeof v === 'string' ? JSON.parse(v) : v;
function canonico(v) {
    if (Array.isArray(v)) return v.map(canonico);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonico(v[k])]));
    return v;
}
const uguali = (a, b) => JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));
const lineupSql = lineup => lineup.map(a => ({ artista_id: a.artista_id, id_attraction_ticketmaster: a.id_attraction_ticketmaster }));
function campiSql(riga) {
    return Object.fromEntries([...CAMPI, 'stato', 'motivo_revisione'].map(k => [k,
        ['latitudine', 'longitudine'].includes(k) && riga[k] !== null ? Number(riga[k]) : riga[k]]));
}
function creaRepository(connessione) {
    const q = (sql, valori = []) => connessione.query(sql, valori);
    return {
        async artisti() {
            const [righe] = await q(`SELECT a.id,a.nome,a.id_ticketmaster,
                DATE_FORMAT(s.prossimo_tentativo,'%Y-%m-%dT%H:%i:%sZ') prossimo_tentativo,s.fallimenti
                FROM artista a LEFT JOIN ticketmaster_artista_sync s ON s.artista_id=a.id
                ORDER BY COALESCE(s.prossimo_tentativo,'1970-01-01'),a.id`);
            return righe;
        },
        async stato() {
            const [righe] = await q("SELECT fallimenti,DATE_FORMAT(prossimo_tentativo,'%Y-%m-%dT%H:%i:%sZ') prossimo_tentativo FROM ticketmaster_sync_stato WHERE id=1");
            return righe[0] ?? { fallimenti: 0, prossimo_tentativo: null };
        },
        async noti(artistaId, oggi) {
            const [righe] = await q(`SELECT e.id,e.id_esterno FROM evento e
                JOIN evento_artista ea ON ea.evento_id=e.id
                WHERE e.fonte='ticketmaster' AND ea.artista_id=? AND e.data_evento>=?`, [artistaId, oggi]);
            return righe;
        },
        async assente(eventoId, adesso) {
            // Un'assenza non è un annullamento: non cancellare e non cambiare stato.
            await q(`INSERT INTO ticketmaster_evento_fonte
                (evento_id,snapshot,protetto_admin,ultimo_controllo,assente_dal)
                SELECT id,JSON_OBJECT('id_esterno',id_esterno),TRUE,?,? FROM evento WHERE id=? AND fonte='ticketmaster'
                ON DUPLICATE KEY UPDATE ultimo_controllo=VALUES(ultimo_controllo),assente_dal=COALESCE(assente_dal,VALUES(assente_dal))`,
                [sqlData(adesso), sqlData(adesso), eventoId]);
        },
        async salva(fonte, adesso) {
            await connessione.beginTransaction();
            try {
                const [righe] = await q(`SELECT *,DATE_FORMAT(data_evento,'%Y-%m-%d') giorno
                    FROM evento WHERE fonte='ticketmaster' AND id_esterno=? FOR UPDATE`, [fonte.id_esterno]);
                let evento = righe[0];
                const campi = fonte.campi;
                let risultato = 'aggiornati', protetto = false, applicati, lineupApplicata, lineupCorrente, snapshotPrecedente;
                if (!evento) {
                    if (!campi.titolo || !campi.data_evento || !fonte.lineup.length) {
                        await connessione.rollback(); return 'scartati';
                    }
                    const motivi = [];
                    if (fonte.lineup.some(a => !a.confermato)) motivi.push('id_artista_da_confermare');
                    if (campi.latitudine === null || campi.longitudine === null) motivi.push('coordinate_irrecuperabili');
                    if (fonte.data_incerta || ['unknown', 'postponed', 'canceled'].includes(fonte.stato_fonte)) motivi.push('stato_fonte_da_verificare');
                    const [doppioni] = await q(`SELECT 1 FROM evento e JOIN evento_artista ea ON ea.evento_id=e.id
                        WHERE e.data_evento=? AND LOWER(e.luogo)=LOWER(?) AND ea.artista_id IN (?) LIMIT 1`,
                        [campi.data_evento, campi.luogo, fonte.lineup.map(a => a.artista_id)]);
                    if (doppioni.length) motivi.push('possibile_doppione');
                    const stato = 'da_valutare';
                    const motivo = motivi.length ? motivi.join('; ') : null;
                    const [inserito] = await q(`INSERT INTO evento (${CAMPI.join(',')},fonte,id_esterno,stato,motivo_revisione)
                        VALUES (?,?,?,?,?,?,?,'ticketmaster',?,?,?)`, [...CAMPI.map(k => campi[k]), fonte.id_esterno, stato, motivo]);
                    evento = { id: inserito.insertId, ...campi, stato, motivo_revisione: motivo };
                    applicati = campiSql(evento); lineupApplicata = lineupSql(fonte.lineup);
                    lineupCorrente = lineupApplicata;
                    for (const a of lineupApplicata) await q('INSERT INTO evento_artista (evento_id,artista_id,id_attraction_ticketmaster) VALUES (?,?,?)',
                        [evento.id, a.artista_id, a.id_attraction_ticketmaster]);
                    risultato = 'daValutare';
                } else {
                    evento.data_evento = evento.giorno;
                    const [fonti] = await q('SELECT * FROM ticketmaster_evento_fonte WHERE evento_id=? FOR UPDATE', [evento.id]);
                    const precedente = fonti[0];
                    snapshotPrecedente = precedente ? json(precedente.snapshot) : null;
                    const [lineup] = await q('SELECT artista_id,id_attraction_ticketmaster FROM evento_artista WHERE evento_id=? ORDER BY artista_id', [evento.id]);
                    lineupCorrente = lineup;
                    applicati = precedente ? json(precedente.campi_applicati) : null;
                    lineupApplicata = precedente ? json(precedente.lineup_applicata) : null;
                    // Le righe importate dal vecchio processo sono protette per
                    // difetto: non sappiamo quali campi siano stati curati.
                    protetto = !precedente || Boolean(precedente.protetto_admin) ||
                        !uguali(campiSql(evento), applicati) || !uguali(lineup, lineupApplicata) || !fonte.lineup.length;
                    if (!uguali(lineupSql(fonte.lineup), lineupApplicata)) protetto = true;
                    if (!protetto && campi.titolo && campi.data_evento && !fonte.data_incerta) {
                        await q(`UPDATE evento SET ${CAMPI.map(k => `${k}=?`).join(',')} WHERE id=?`, [...CAMPI.map(k => campi[k]), evento.id]);
                        // Non promuovere un evento in coda o scartato. I collegamenti
                        // già presenti non vengono riscritti con candidati diversi.
                        applicati = campiSql({ ...evento, ...campi });
                    }
                    if (protetto) risultato = 'protetti';
                }
                const modifiche = !uguali(CAMPI.map(k => campi[k]), CAMPI.map(k => (protetto ? campiSql(evento) : applicati ?? campiSql(evento))[k])) ||
                    !uguali(lineupSql(fonte.lineup), protetto ? lineupCorrente : lineupApplicata);
                await q(`INSERT INTO ticketmaster_evento_fonte
                    (evento_id,snapshot,campi_applicati,lineup_applicata,protetto_admin,stato_fonte,ultimo_controllo,ultimo_avvistamento,assente_dal,modifiche_fonte)
                    VALUES (?,?,?,?,?,?,?,?,NULL,?) ON DUPLICATE KEY UPDATE
                    snapshot=VALUES(snapshot),campi_applicati=VALUES(campi_applicati),lineup_applicata=VALUES(lineup_applicata),
                    protetto_admin=VALUES(protetto_admin),stato_fonte=VALUES(stato_fonte),ultimo_controllo=VALUES(ultimo_controllo),
                    ultimo_avvistamento=VALUES(ultimo_avvistamento),assente_dal=NULL,modifiche_fonte=VALUES(modifiche_fonte)`,
                    [evento.id, JSON.stringify(fonte), applicati ? JSON.stringify(applicati) : null, lineupApplicata ? JSON.stringify(lineupApplicata) : null,
                        protetto, fonte.stato_fonte, sqlData(adesso), sqlData(adesso), modifiche]);
                // Un cambiamento sostanziale invalida l'esito AI subito, prima del prossimo worker.
                const identita = s => s && ({ campi: s.campi, attractions: s.attractions, lineup: s.lineup,
                    stato_fonte: s.stato_fonte, data_incerta: s.data_incerta, venue: s.venue });
                if (snapshotPrecedente && !uguali(identita(snapshotPrecedente), identita(fonte))) {
                    await q(`UPDATE ollama_evento_job SET stato='da_valutare',generazione=generazione+1,input_hash=NULL,
                        tentativi=0,prossimo_tentativo=UTC_TIMESTAMP(3),motivazione=NULL,errore=NULL,valutato_at=NULL WHERE evento_id=?`, [evento.id]);
                    await q("UPDATE evento SET stato='da_valutare' WHERE id=?", [evento.id]);
                    if (!protetto && applicati) await q(`UPDATE ticketmaster_evento_fonte SET campi_applicati=JSON_SET(campi_applicati,'$.stato','da_valutare') WHERE evento_id=?`, [evento.id]);
                }
                await connessione.commit(); return risultato;
            } catch (errore) { await connessione.rollback(); throw errore; }
        },
        async esitoArtista(artista, adesso, prossimo, codice = null) {
            await q(`INSERT INTO ticketmaster_artista_sync
                (artista_id,ultimo_tentativo,ultimo_successo,prossimo_tentativo,fallimenti,errore)
                VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
                ultimo_tentativo=VALUES(ultimo_tentativo),ultimo_successo=IF(VALUES(errore) IS NULL,VALUES(ultimo_successo),ultimo_successo),
                prossimo_tentativo=VALUES(prossimo_tentativo),fallimenti=VALUES(fallimenti),errore=VALUES(errore)`,
                [artista.id, sqlData(adesso), codice ? null : sqlData(adesso), sqlData(prossimo), codice ? (artista.fallimenti ?? 0) + 1 : 0, codice]);
        },
        async esitoCiclo(adesso, riepilogo) {
            const completo = riepilogo.esito === 'ok';
            await q(`INSERT INTO ticketmaster_sync_stato (id,ultimo_tentativo,ultimo_successo,errore,richieste,esito,prossimo_tentativo,fallimenti)
                VALUES (1,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ultimo_tentativo=VALUES(ultimo_tentativo),
                ultimo_successo=IF(VALUES(esito)='ok',VALUES(ultimo_successo),ultimo_successo),errore=VALUES(errore),richieste=VALUES(richieste),esito=VALUES(esito),
                prossimo_tentativo=VALUES(prossimo_tentativo),fallimenti=VALUES(fallimenti)`,
                [sqlData(adesso), completo ? sqlData(adesso) : null, riepilogo.errore, riepilogo.richieste, riepilogo.esito,
                    riepilogo.prossimo ? sqlData(riepilogo.prossimo) : null, riepilogo.fallimentiGlobali]);
        },
    };
}
async function conBlocco(pool, lavoro) {
    const c = await pool.getConnection();
    let nome, acquisito = false;
    try {
        const [[db]] = await c.query('SELECT DATABASE() nome');
        if (!db.nome) throw new Error('DATABASE_NON_CONFIGURATO');
        nome = `${db.nome}:ticketmaster-sync`;
        const [[lock]] = await c.query('SELECT GET_LOCK(?,0) acquisito', [nome]);
        acquisito = lock.acquisito === 1;
        if (!acquisito) return { esito: 'occupato' };
        await c.query("SET time_zone='+00:00'");
        return await lavoro(creaRepository(c));
    } finally {
        if (acquisito) await c.query('SELECT RELEASE_LOCK(?)', [nome]).catch(() => {});
        c.release();
    }
}
module.exports = { creaRepository, conBlocco, uguali };
