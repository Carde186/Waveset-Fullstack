const express = require('express');
const { creaService } = require('../../artistiProvider/service');
const { providerAttivo } = require('../../artistiProvider/configurazione');
const { ErroreAppleMusic } = require('../../appleMusic/errore');
const messaggi = {
    APPLE_CONFIGURAZIONE: 'Apple Music non configurato o configurazione non valida.',
    APPLE_NON_TROVATO: 'Artista non trovato nel catalogo Apple Music.',
    ARTISTA_NON_TROVATO: 'Artista Waveset non trovato.',
    APPLE_PARAMETRI: 'Parametri Apple Music non validi.',
    APPLE_LINK_ASSENTE: 'Nessun collegamento Apple Music confermato.',
    APPLE_CONFLITTO: 'Il collegamento è cambiato. Ricaricare prima di confermare.',
    APPLE_GIA_COLLEGATO: 'Questo artista Apple Music è già collegato a un altro artista Waveset.',
    APPLE_AUTORIZZAZIONE: 'Apple Music non ha autorizzato la richiesta. Verificare la configurazione server.',
    APPLE_LIMITE: 'Apple Music ha limitato le richieste. Riprovare più tardi.',
    APPLE_TIMEOUT: 'Apple Music non ha risposto in tempo.',
    APPLE_DATI_INVALIDI: 'Apple Music ha restituito dati non validi.',
};
function creaRouteAdminArtisti(appleService, { services = {}, env = process.env, db = require('../../config/database') } = {}) {
    const router = express.Router();
    const istanze = { ...services, ...(appleService ? { apple_music: appleService } : {}) };
    const service = provider => istanze[provider] ??= creaService({ provider });
    const gestisci = fn => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json(await fn(req)); }
        catch (e) {
            const noto = e instanceof ErroreAppleMusic;
            const codice = noto ? e.codice : req.path.includes('/apple-music') ? 'APPLE_SERVER' : req.path.includes('/deezer') ? 'DEEZER_SERVER' : 'PROVIDER_SERVER';
            res.status(noto ? e.stato : 500).json({ codice, messaggio: messaggi[codice] ??
                (codice.startsWith('DEEZER_') ? 'Impossibile completare la richiesta Deezer. Riprovare più tardi.' :
                    codice.startsWith('APPLE_') ? 'Impossibile completare la richiesta Apple Music. Riprovare più tardi.' : 'Impossibile completare la richiesta al provider artisti.') });
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
            return res.status(400).json({ codice: 'APPLE_PARAMETRI', messaggio: messaggi.APPLE_PARAMETRI });
        }
        next();
    };
    router.get('/:id/provider', valida, gestisci(req => service(providerAttivo(env)).leggi(Number(req.params.id))));
    for (const [provider, percorso] of [['apple_music', 'apple-music'], ['deezer', 'deezer']]) {
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
