const { creaRepository: base } = require('./repositoryProfilo');
const { ErroreProvider } = require('./errore');
const { normalizzaNome } = require('./presenzaTicketmaster');
const nonVerificato = () => ({ stato: 'non_verificato', attractions: [], ambiguo: false, controllatoAt: null });
function creaRepository(pool, provider) {
    const repository = base(pool, provider, async (c, corrente, dati) => {
        if (corrente && (corrente.external_id !== dati.externalId || corrente.storefront !== dati.storefront)) {
            await c.query('DELETE FROM artista_ticketmaster_presenza WHERE link_id=?', [corrente.id]);
        }
    });
    const prefisso = 'DEEZER';
    async function leggiPresenza(id, link, db = pool) {
        const [[r]] = await db.query(`SELECT p.esito_json,a.id_ticketmaster FROM artista a
            LEFT JOIN artista_provider_link l ON l.artista_id=a.id AND l.provider=?
            ${link ? 'AND l.external_id=? AND l.storefront=?' : ''}
            LEFT JOIN artista_ticketmaster_presenza p ON p.link_id=l.id
            AND l.external_id=p.external_id AND l.storefront=p.storefront WHERE a.id=?`,
            [provider, ...(link ? [link.externalId, link.storefront] : []), id]);
        const esito = r?.esito_json ? (typeof r.esito_json === 'string' ? JSON.parse(r.esito_json) : r.esito_json) : nonVerificato();
        return { ...esito, attractionConfermata: r?.id_ticketmaster ?? null };
    }
    return {
        ...repository,
        leggiPresenza,
        async salvaPresenza(id, link, esito) {
            const c = await pool.getConnection();
            try {
                await c.beginTransaction();
                const [[r]] = await c.query('SELECT id,external_id,storefront,versione FROM artista_provider_link WHERE artista_id=? AND provider=? FOR UPDATE', [id, provider]);
                if (!r || r.external_id !== link.externalId || r.storefront !== link.storefront || r.versione !== link.versione) throw new ErroreProvider(`${prefisso}_CONFLITTO`, 409);
                await c.query(`INSERT INTO artista_ticketmaster_presenza (link_id,external_id,storefront,esito_json,controllato_at)
                    VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE external_id=VALUES(external_id),storefront=VALUES(storefront),esito_json=VALUES(esito_json),controllato_at=VALUES(controllato_at)`,
                [r.id, link.externalId, link.storefront, JSON.stringify(esito), new Date(esito.controllatoAt)]);
                const presenza = await leggiPresenza(id, link, c);
                await c.commit();
                return presenza;
            } catch (e) { await c.rollback(); throw e; }
            finally { c.release(); }
        },
        async confermaIdentita(id, link, scelta, attesa, esito) {
            const c = await pool.getConnection();
            try {
                await c.beginTransaction();
                const [[artista]] = await c.query('SELECT nome,id_ticketmaster FROM artista WHERE id=? FOR UPDATE', [id]);
                if (!artista) throw new ErroreProvider('ARTISTA_NON_TROVATO', 404);
                const [[r]] = await c.query('SELECT id,external_id,storefront,versione FROM artista_provider_link WHERE artista_id=? AND provider=? FOR UPDATE', [id, provider]);
                if (!r || r.external_id !== link.externalId || r.storefront !== link.storefront || r.versione !== link.versione) throw new ErroreProvider('DEEZER_CONFLITTO', 409);
                if (scelta !== null && normalizzaNome(artista.nome) !== normalizzaNome(link.name)) throw new ErroreProvider('TICKETMASTER_IDENTITA_INVALIDA', 400);
                const corrente = artista.id_ticketmaster;
                if (corrente !== attesa && corrente !== scelta) throw new ErroreProvider('TICKETMASTER_CONFLITTO', 409);
                if (esito) await c.query(`INSERT INTO artista_ticketmaster_presenza (link_id,external_id,storefront,esito_json,controllato_at)
                    VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esito_json=VALUES(esito_json),external_id=VALUES(external_id),storefront=VALUES(storefront),controllato_at=VALUES(controllato_at)`,
                    [r.id, link.externalId, link.storefront, JSON.stringify(esito), new Date(esito.controllatoAt)]);
                if (corrente !== scelta) {
                    await c.query('UPDATE artista SET id_ticketmaster=? WHERE id=?', [scelta, id]);
                    // Nascondere e invalidare nella stessa transazione, anche se
                    // l'identità torna al valore iniziale prima del prossimo ciclo.
                    await c.query(`UPDATE evento e JOIN evento_artista ea ON ea.evento_id=e.id
                        SET e.stato='da_valutare' WHERE ea.artista_id=? AND e.fonte='ticketmaster'`, [id]);
                    await c.query(`UPDATE ollama_evento_job j JOIN evento e ON e.id=j.evento_id
                        JOIN evento_artista ea ON ea.evento_id=e.id
                        SET j.stato='da_valutare',j.generazione=j.generazione+1,j.input_hash=NULL,
                        j.tentativi=0,j.prossimo_tentativo=UTC_TIMESTAMP(3),j.errore=NULL,
                        j.motivazione=NULL,j.valutato_at=NULL
                        WHERE ea.artista_id=? AND e.fonte='ticketmaster'`, [id]);
                    await c.query(`UPDATE ticketmaster_evento_fonte sf JOIN evento_artista ea ON ea.evento_id=sf.evento_id
                        SET sf.campi_applicati=JSON_SET(sf.campi_applicati,'$.stato','da_valutare')
                        WHERE ea.artista_id=? AND sf.protetto_admin=FALSE AND sf.campi_applicati IS NOT NULL`, [id]);
                }
                const presenza = await leggiPresenza(id, link, c);
                await c.commit();
                return presenza;
            } catch (e) {
                await c.rollback();
                if (e.code === 'ER_DUP_ENTRY') throw new ErroreProvider('TICKETMASTER_GIA_COLLEGATO', 409);
                throw e;
            } finally { c.release(); }
        },
    };
}
module.exports = { creaRepository, nonVerificato };
