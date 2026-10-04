const { ErroreAppleMusic } = require('./errore');
const { pubblico } = require('./client');
function profilo(r, provider) {
    if (!r) return null;
    const dati = typeof r.dati_normalizzati_json === 'string' ? JSON.parse(r.dati_normalizzati_json) : r.dati_normalizzati_json;
    return { ...(provider === 'deezer' ? { provider, fan: dati.fan ?? null, immagine: dati.immagine ?? null } : {}), externalId: dati.externalId, name: dati.name, url: dati.url, artwork: dati.artwork,
        genres: dati.genres, storefront: dati.storefront, syncedAt: dati.syncedAt, versione: r.versione };
}
function creaRepository(pool, provider = 'apple_music', dopoSalvataggio) {
    if (!['apple_music', 'deezer'].includes(provider)) throw new ErroreAppleMusic('PROVIDER_CONFIGURAZIONE', 503);
    const prefisso = provider === 'deezer' ? 'DEEZER' : 'APPLE';
    return {
        async artista(id) {
            const [[r]] = await pool.query('SELECT id, nome, immagine_url FROM artista WHERE id = ?', [id]);
            if (!r) throw new ErroreAppleMusic('ARTISTA_NON_TROVATO', 404);
            return r;
        },
        async leggi(id) {
            const [[r]] = await pool.query(`SELECT dati_normalizzati_json, versione FROM artista_provider_link WHERE artista_id = ? AND provider = '${provider}'`, [id]);
            return profilo(r, provider);
        },
        async salva(id, dati, versioneAttesa) {
            // Due primi link su artisti diversi possono contendere un gap
            // InnoDB: ripeti solo la transazione, mai la chiamata al provider.
            for (let tentativo = 0; tentativo < 3; tentativo++) {
                const c = await pool.getConnection();
                try {
                    await c.beginTransaction();
                    // Serializza tutte le scritture per artista, anche il primo link.
                    const [[artista]] = await c.query('SELECT id FROM artista WHERE id = ? FOR UPDATE', [id]);
                    if (!artista) throw new ErroreAppleMusic('ARTISTA_NON_TROVATO', 404);
                    const [[corrente]] = await c.query(`SELECT id, external_id, storefront, versione FROM artista_provider_link WHERE artista_id = ? AND provider = '${provider}' FOR UPDATE`, [id]);
                    if ((corrente?.versione ?? null) !== versioneAttesa) throw new ErroreAppleMusic(`${prefisso}_CONFLITTO`, 409);
                    const valori = [dati.externalId, dati.storefront, dati.url, dati.artwork?.url ?? null,
                        JSON.stringify(pubblico(dati)), JSON.stringify(dati.raw), new Date(dati.syncedAt)];
                    if (corrente) {
                        await c.query('UPDATE artista_provider_link SET external_id=?, storefront=?, url=?, immagine_url=?, dati_normalizzati_json=?, raw_json=?, sincronizzato_at=?, versione=versione+1 WHERE id=?', [...valori, corrente.id]);
                    } else {
                        await c.query(`INSERT INTO artista_provider_link (artista_id, provider, external_id, storefront, url, immagine_url, dati_normalizzati_json, raw_json, sincronizzato_at) VALUES (?, '${provider}', ?, ?, ?, ?, ?, ?, ?)`, [id, ...valori]);
                    }
                    if (dopoSalvataggio) await dopoSalvataggio(c, corrente, dati);
                    await c.commit();
                    return { ...pubblico(dati), versione: (corrente?.versione ?? 0) + 1 };
                } catch (e) {
                    await c.rollback();
                    if (e.code === 'ER_LOCK_DEADLOCK' && tentativo < 2) continue;
                    if (e.code === 'ER_DUP_ENTRY') throw new ErroreAppleMusic(`${prefisso}_GIA_COLLEGATO`, 409);
                    throw e;
                } finally { c.release(); }
            }
        },
    };
}
module.exports = { creaRepository };
