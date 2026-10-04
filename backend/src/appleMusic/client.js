const { configurazione, creaToken } = require('./token');
const { ErroreAppleMusic } = require('./errore');
const BASE = 'https://api.music.apple.com/v1/catalog/';
const oggetto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function urlSicuro(v, dominio) {
    try {
        const u = new URL(v);
        return u.protocol === 'https:' && !u.username && !u.password &&
            (u.hostname === dominio || u.hostname.endsWith(`.${dominio}`)) ? u.href : null;
    } catch { return null; }
}
function normalizza(r, storefront, ora) {
    if (!oggetto(r) || r.type !== 'artists' || typeof r.id !== 'string' || !/^[1-9]\d{0,29}$/.test(r.id) || !oggetto(r.attributes) ||
        typeof r.attributes.name !== 'string' || !r.attributes.name.trim() || r.attributes.name.length > 500) {
        throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
    }
    const a = r.attributes;
    const url = urlSicuro(a.url, 'music.apple.com');
    if (!url || !Array.isArray(a.genreNames) || a.genreNames.some(g => typeof g !== 'string' || g.length > 200)) {
        throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
    }
    let artwork = null;
    if (a.artwork != null) {
        if (!oggetto(a.artwork) || typeof a.artwork.url !== 'string') throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
        const template = a.artwork.url;
        const immagine = urlSicuro(template.replaceAll('{w}', '300').replaceAll('{h}', '300').replaceAll('{f}', 'jpg'), 'mzstatic.com');
        if (!immagine) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
        artwork = { url: immagine, width: Number.isFinite(a.artwork.width) ? a.artwork.width : null,
            height: Number.isFinite(a.artwork.height) ? a.artwork.height : null };
    }
    return { externalId: r.id, name: a.name.trim(), url, artwork, genres: a.genreNames,
        storefront, syncedAt: new Date(ora()).toISOString(), raw: r };
}
function pubblico({ raw, ...profilo }) { return profilo; }
function creaClient({ env = process.env, fetchImpl = globalThis.fetch, ora = () => Date.now(),
    attendi = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    let config, token;
    function prepara() {
        if (!config) { config = configurazione(env); token = creaToken(config, ora); }
        return config;
    }
    async function richiesta(percorso) {
        prepara();
        for (let tentativo = 0; tentativo < 2; tentativo++) {
            const controllo = new AbortController();
            let scaduto = false;
            const timer = setTimeout(() => { scaduto = true; controllo.abort(); }, config.timeout);
            let ritardo = 250;
            let ripetibile = true;
            try {
                const risposta = await fetchImpl(BASE + percorso, { method: 'GET', redirect: 'error',
                    headers: { Accept: 'application/json', Authorization: `Bearer ${token.leggi()}` }, signal: controllo.signal });
                if (!risposta.ok) {
                    await risposta.body?.cancel();
                    if (risposta.status === 401 || risposta.status === 403) {
                        token.invalida(); throw new ErroreAppleMusic('APPLE_AUTORIZZAZIONE');
                    }
                    if (risposta.status === 404) throw new ErroreAppleMusic('APPLE_NON_TROVATO', 404);
                    if (risposta.status === 429 || risposta.status >= 500) {
                        const dopo = risposta.headers.get('Retry-After');
                        const sec = dopo === null ? NaN : Number(dopo);
                        const ms = Number.isFinite(sec) ? sec * 1000 : Date.parse(dopo) - ora();
                        // Una lunga attesa va mostrata all'ADMIN, non anticipata.
                        if (ms > 1000) { ripetibile = false; throw new ErroreAppleMusic(risposta.status === 429 ? 'APPLE_LIMITE' : 'APPLE_TEMPORANEO', 503); }
                        ritardo = Number.isFinite(ms) ? Math.max(0, ms) : 250;
                        throw new ErroreAppleMusic(risposta.status === 429 ? 'APPLE_LIMITE' : 'APPLE_TEMPORANEO', 503);
                    }
                    throw new ErroreAppleMusic('APPLE_RISPOSTA');
                }
                // Limite anche per risposte chunked; timer attivo fino al parsing.
                const lettore = risposta.body?.getReader();
                if (!lettore) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
                const parti = []; let dimensione = 0;
                while (true) {
                    const { done, value } = await lettore.read();
                    if (done) break;
                    dimensione += value.byteLength;
                    if (dimensione > 1048576) { await lettore.cancel(); throw new ErroreAppleMusic('APPLE_DATI_INVALIDI'); }
                    parti.push(Buffer.from(value));
                }
                let dati;
                try { dati = JSON.parse(Buffer.concat(parti).toString('utf8')); } catch { throw new ErroreAppleMusic('APPLE_DATI_INVALIDI'); }
                if (!oggetto(dati) || dati.errors) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
                return dati;
            } catch (errore) {
                const sicuro = errore instanceof ErroreAppleMusic ? errore : new ErroreAppleMusic(scaduto ? 'APPLE_TIMEOUT' : 'APPLE_RETE', 503);
                if (tentativo === 1 || !['APPLE_TEMPORANEO', 'APPLE_RETE', 'APPLE_TIMEOUT', 'APPLE_LIMITE'].includes(sicuro.codice) ||
                    !ripetibile) throw sicuro;
                clearTimeout(timer);
                await attendi(ritardo);
            } finally { clearTimeout(timer); }
        }
    }
    function sf(v) {
        const valore = v ?? prepara().storefront;
        if (!/^[a-z]{2}$/.test(valore)) throw new ErroreAppleMusic('APPLE_PARAMETRI', 400);
        return valore;
    }
    return {
        async cerca(q) {
            if (typeof q !== 'string' || !q.trim() || q.trim().length > 200) throw new ErroreAppleMusic('APPLE_PARAMETRI', 400);
            const storefront = sf();
            const dati = await richiesta(`${storefront}/search?${new URLSearchParams({ term: q.trim(), types: 'artists', limit: '10' })}`);
            if (!oggetto(dati.results)) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
            if (!Object.hasOwn(dati.results, 'artists') && Object.keys(dati.results).length === 0) return [];
            if (!oggetto(dati.results.artists) || !Array.isArray(dati.results.artists.data)) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
            if (dati.results.artists.data.length > 10 || new Set(dati.results.artists.data.map(r => r?.id)).size !== dati.results.artists.data.length) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
            return dati.results.artists.data.map(r => normalizza(r, storefront, ora));
        },
        async dettaglio(id, paese) {
            if (typeof id !== 'string' || !/^[1-9]\d{0,29}$/.test(id)) throw new ErroreAppleMusic('APPLE_PARAMETRI', 400);
            const storefront = sf(paese);
            const dati = await richiesta(`${storefront}/artists/${id}`);
            if (!Array.isArray(dati.data)) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
            if (dati.data.length === 0) throw new ErroreAppleMusic('APPLE_NON_TROVATO', 404);
            if (dati.data.length !== 1 || dati.data[0]?.id !== id) throw new ErroreAppleMusic('APPLE_DATI_INVALIDI');
            return normalizza(dati.data[0], storefront, ora);
        },
        storefront: () => prepara().storefront,
    };
}
module.exports = { creaClient, normalizza, pubblico };
