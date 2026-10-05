const { creaRepository: base } = require('./repositoryProfilo');
const { ErroreProvider } = require('./errore');
const nonVerificato = () => ({ stato: 'non_verificato', attractions: [], ambiguo: false, controllatoAt: null });
function creaRepository(pool, provider) {
    const repository = base(pool, provider, async (c, corrente, dati) => {
        if (corrente && (corrente.external_id !== dati.externalId || corrente.storefront !== dati.storefront)) {
            await c.query('DELETE FROM artista_ticketmaster_presenza WHERE link_id=?', [corrente.id]);
        }
    });
    const prefisso = 'DEEZER';
    return {
        ...repository,
        async leggiPresenza(id, link) {
            const [[r]] = await pool.query(`SELECT p.esito_json FROM artista_ticketmaster_presenza p
                INNER JOIN artista_provider_link l ON l.id=p.link_id
                AND l.external_id=p.external_id AND l.storefront=p.storefront
                WHERE l.artista_id=? AND l.provider=?
                ${link ? 'AND l.external_id=? AND l.storefront=?' : ''}`, [id, provider, ...(link ? [link.externalId, link.storefront] : [])]);
            return r ? (typeof r.esito_json === 'string' ? JSON.parse(r.esito_json) : r.esito_json) : nonVerificato();
        },
        async salvaPresenza(id, link, esito) {
            const c = await pool.getConnection();
            try {
                await c.beginTransaction();
                const [[r]] = await c.query('SELECT id,external_id,storefront,versione FROM artista_provider_link WHERE artista_id=? AND provider=? FOR UPDATE', [id, provider]);
                if (!r || r.external_id !== link.externalId || r.storefront !== link.storefront || r.versione !== link.versione) throw new ErroreProvider(`${prefisso}_CONFLITTO`, 409);
                await c.query(`INSERT INTO artista_ticketmaster_presenza (link_id,external_id,storefront,esito_json,controllato_at)
                    VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE external_id=VALUES(external_id),storefront=VALUES(storefront),esito_json=VALUES(esito_json),controllato_at=VALUES(controllato_at)`,
                [r.id, link.externalId, link.storefront, JSON.stringify(esito), new Date(esito.controllatoAt)]);
                await c.commit();
                return esito;
            } catch (e) { await c.rollback(); throw e; }
            finally { c.release(); }
        },
    };
}
module.exports = { creaRepository, nonVerificato };
