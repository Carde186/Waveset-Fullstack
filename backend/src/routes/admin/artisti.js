const express = require('express');
const { creaService } = require('../../artistiProvider/service');
const { providerAttivo } = require('../../artistiProvider/configurazione');
const { ErroreProvider } = require('../../artistiProvider/errore');
const messaggi = {
    ARTISTA_NON_TROVATO: 'Artista Waveset non trovato.',
    DEEZER_PARAMETRI: 'Parametri Deezer non validi.',
    DEEZER_LINK_ASSENTE: 'Nessun collegamento Deezer confermato.',
    DEEZER_CONFLITTO: 'Il collegamento è cambiato. Ricaricare prima di confermare.',
    DEEZER_GIA_COLLEGATO: 'Questo artista Deezer è già collegato a un altro artista Waveset.',
};
function creaRouteAdminArtisti({ services = {}, env = process.env, db = require('../../config/database') } = {}) {
    const router = express.Router();
    const istanze = { ...services };
    const service = provider => istanze[provider] ??= creaService({ provider });
    const gestisci = fn => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json(await fn(req)); }
        catch (e) {
            const noto = e instanceof ErroreProvider;
            const codice = noto ? e.codice : req.path.includes('/deezer') ? 'DEEZER_SERVER' : 'PROVIDER_SERVER';
            res.status(noto ? e.stato : 500).json({ codice, messaggio: messaggi[codice] ??
                (codice.startsWith('DEEZER_') ? 'Impossibile completare la richiesta Deezer. Riprovare più tardi.' :
                    'Impossibile completare la richiesta al provider artisti.') });
        }
    };
    router.get('/', gestisci(async () => {
        const [artisti] = await db.query(`SELECT a.id, a.nome, l.provider AS provider_collegato
            FROM artista a
            LEFT JOIN artista_provider_link l ON l.artista_id=a.id AND l.provider=?
            ORDER BY a.nome, a.id`, [providerAttivo(env)]);
        return artisti;
    }));
    router.get('/provider', gestisci(() => ({ provider: providerAttivo(env) })));
    const valida = (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) > 2147483647) {
            return res.status(400).json({ codice: 'DEEZER_PARAMETRI', messaggio: messaggi.DEEZER_PARAMETRI });
        }
        next();
    };
    router.get('/:id/provider', valida, gestisci(req => service(providerAttivo(env)).leggi(Number(req.params.id))));
    for (const [provider, percorso] of [['deezer', 'deezer']]) {
        router.use(`/:id/${percorso}`, valida);
        router.get(`/:id/${percorso}`, gestisci(req => service(provider).leggi(Number(req.params.id))));
        router.get(`/:id/${percorso}/search`, gestisci(req => service(provider).cerca(Number(req.params.id), req.query.q)));
        router.post(`/:id/${percorso}/collegamento`, gestisci(req => service(provider).collega(Number(req.params.id), req.body)));
        router.post(`/:id/${percorso}/sincronizza`, gestisci(req => service(provider).sincronizza(Number(req.params.id), req.body)));
        router.post(`/:id/${percorso}/ticketmaster`, gestisci(req => service(provider).ricontrolla(Number(req.params.id), req.body)));
    }
    return router;
}
module.exports = { creaRouteAdminArtisti };
