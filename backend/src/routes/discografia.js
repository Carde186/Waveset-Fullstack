const express = require('express');
const { creaClient, urlSicuro } = require('../deezer/client');
const { artistaPubblico } = require('../catalogo/pubblico');
const { SOLO_PUBBLICATI } = require('../utilita/eventi');
function creaRoute({ pool = require('../config/database'), client = creaClient() } = {}) {
    const router = express.Router();
    router.get('/artisti/:id/discografia', async (req, res) => {
        const { id } = req.params;
        const offset = req.query.indice ?? '0';
        if (!/^[1-9]\d{0,9}$/.test(id) || typeof offset !== 'string' || !/^\d{1,4}$/.test(offset) || Number(offset) % 12 || Number(offset) > 1200) return res.status(400).json({ messaggio: 'Parametri non validi' });
        const [[a]] = await pool.query(`SELECT a.id,l.external_id FROM artista a
            LEFT JOIN artista_provider_link l ON l.artista_id=a.id AND l.provider='deezer'
            WHERE a.id=? AND ${artistaPubblico()}`, [id]);
        if (!a) return res.status(404).json({ messaggio: 'Artista non trovato' });
        res.set('Cache-Control', 'no-store');
        if (!a.external_id) return res.json({ disponibile: false, brani: [], pubblicazioni: [], prossimoIndice: null });
        try { res.json({ disponibile: true, ...await client.discografia(String(a.external_id), Number(offset)) }); }
        catch (e) { res.status(e.stato >= 400 && e.stato <= 599 ? e.stato : 503).json({ messaggio: 'Discografia Deezer temporaneamente non disponibile', codice: e.codice ?? 'DEEZER_TEMPORANEO' }); }
    });
    router.get('/catalogo/copertine', async (req, res) => {
        // Solo copertine salvate: nessuna foto profilo, proxy o ricerca esterna.
        const [eventi] = await pool.query(`SELECT e.id,e.titolo,JSON_EXTRACT(sf.snapshot,'$.immagine.url') url
            FROM evento e JOIN ticketmaster_evento_fonte sf ON sf.evento_id=e.id
            WHERE ${SOLO_PUBBLICATI} AND e.data_evento>=CURDATE() ORDER BY e.data_evento,e.id LIMIT 12`);
        const [album] = await pool.query(`SELECT al.id,al.titolo,al.copertina_url url FROM album al
            JOIN artista a ON a.id=al.artista_id WHERE ${artistaPubblico()} AND al.copertina_url IS NOT NULL
            ORDER BY al.data_pubblicazione DESC,al.id LIMIT 12`);
        function leggi(r, tipo) {
            let raw = r.url;
            if (typeof raw === 'string' && raw.startsWith('"')) { try { raw = JSON.parse(raw); } catch { return null; } }
            const url = urlSicuro(raw, tipo === 'evento' ? ['ticketm.net', 'ticketmaster.com', 'livenation.com'] : ['dzcdn.net', 'mzstatic.com']);
            if (!url || (tipo === 'album' && new URL(url).pathname.includes('/images/artist/'))) return null;
            return { id: `${tipo}-${r.id}`, titolo: r.titolo, tipo, url };
        }
        res.set('Cache-Control', 'public, max-age=300');
        res.json([...album.map(r => leggi(r, 'album')), ...eventi.map(r => leggi(r, 'evento'))].filter(Boolean));
    });
    return router;
}
module.exports = { creaRoute };
