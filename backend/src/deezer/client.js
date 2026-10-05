const { ErroreProvider } = require('../artistiProvider/errore');
const BASE = 'https://api.deezer.com';
const oggetto = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function urlSicuro(v, domini) {
    try {
        const u = new URL(v);
        return u.protocol === 'https:' && !u.username && !u.password && domini.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`)) ? u.href : null;
    } catch { return null; }
}
function normalizza(r, ora = Date.now) {
    if (!oggetto(r) || r.type !== 'artist' || !Number.isSafeInteger(r.id) || r.id <= 0 ||
        typeof r.name !== 'string' || !r.name.trim() || r.name.length > 500) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
    const url = urlSicuro(r.link, ['deezer.com']);
    if (!url) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
    let artwork = null;
    for (const [campo, dimensione] of [['picture_medium', 250], ['picture_big', 500], ['picture_xl', 1000], ['picture_small', 56], ['picture', null]]) {
        const immagine = urlSicuro(r[campo], ['dzcdn.net', 'deezer.com']);
        if (immagine) { artwork = { url: immagine, width: dimensione, height: dimensione }; break; }
    }
    const generi = Array.isArray(r.genres) ? r.genres : Array.isArray(r.genres?.data) ? r.genres.data : [];
    return { externalId: String(r.id), name: r.name.trim(), provider: 'deezer', url,
        fan: Number.isSafeInteger(r.nb_fan) && r.nb_fan >= 0 ? r.nb_fan : null,
        immagine: artwork?.url ?? null, artwork,
        genres: [...new Set(generi.map(g => typeof g === 'string' ? g : g?.name).filter(g => typeof g === 'string' && g.trim() && g.length <= 200))],
        storefront: '', raw: r, syncedAt: new Date(ora()).toISOString() };
}
function creaClient({ env = process.env, fetchImpl = globalThis.fetch, ora = Date.now,
    attendi = ms => new Promise(r => setTimeout(r, ms)), maxRichieste = 8, finestraMs = 1000, cacheMs = 60000 } = {}) {
    const timeout = Number(env.DEEZER_TIMEOUT_MS || 8000);
    if (!Number.isInteger(timeout) || timeout < 10 || timeout > 30000) throw new ErroreProvider('DEEZER_CONFIGURAZIONE', 503);
    const cache = new Map(), inCorso = new Map(), prenotazioni = [];
    function prenota() {
        while (prenotazioni.length && prenotazioni[0] <= ora() - finestraMs) prenotazioni.shift();
        if (prenotazioni.length >= maxRichieste) throw new ErroreProvider('DEEZER_LIMITE', 503);
        prenotazioni.push(ora());
    }
    async function richiesta(percorso) {
        for (let n = 0; n < 2; n++) {
            prenota();
            const controllo = new AbortController();
            const timer = setTimeout(() => controllo.abort(), timeout);
            let ripetibile = false, attesa = 250;
            try {
                const r = await fetchImpl(BASE + percorso, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json' }, signal: controllo.signal });
                if (!r.ok) {
                    await r.body?.cancel();
                    if (r.status === 404) throw new ErroreProvider('DEEZER_NON_TROVATO', 404);
                    if (r.status === 429 || r.status >= 500) {
                        const h = r.headers.get('Retry-After');
                        const secondi = h === null ? NaN : Number(h);
                        const ms = Number.isFinite(secondi) ? secondi * 1000 : Date.parse(h) - ora();
                        ripetibile = !Number.isFinite(ms) || ms <= 1000;
                        attesa = Number.isFinite(ms) ? Math.max(0, ms) : 250;
                        throw new ErroreProvider(r.status === 429 ? 'DEEZER_LIMITE' : 'DEEZER_TEMPORANEO', 503);
                    }
                    throw new ErroreProvider('DEEZER_RISPOSTA');
                }
                const reader = r.body?.getReader();
                if (!reader) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
                const parti = []; let byte = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    byte += value.byteLength;
                    if (byte > 1048576) { await reader.cancel(); throw new ErroreProvider('DEEZER_DATI_INVALIDI'); }
                    parti.push(Buffer.from(value));
                }
                let dati;
                try { dati = JSON.parse(Buffer.concat(parti).toString('utf8')); } catch { throw new ErroreProvider('DEEZER_DATI_INVALIDI'); }
                if (!oggetto(dati)) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
                if (Object.hasOwn(dati, 'error')) {
                    if (dati.error?.code === 800) throw new ErroreProvider('DEEZER_NON_TROVATO', 404);
                    if (dati.error?.code === 4) { ripetibile = true; throw new ErroreProvider('DEEZER_LIMITE', 503); }
                    throw new ErroreProvider('DEEZER_RISPOSTA');
                }
                return dati;
            } catch (e) {
                const sicuro = e instanceof ErroreProvider ? e : new ErroreProvider(controllo.signal.aborted ? 'DEEZER_TIMEOUT' : 'DEEZER_RETE', 503);
                if (!(e instanceof ErroreProvider)) ripetibile = true;
                if (n === 1 || !ripetibile) throw sicuro;
                clearTimeout(timer); await attendi(attesa);
            } finally { clearTimeout(timer); }
        }
    }
    async function cerca(q) {
        if (typeof q !== 'string' || !q.trim() || q.trim().length > 200) throw new ErroreProvider('DEEZER_PARAMETRI', 400);
        const chiave = q.trim().replace(/\s+/g, ' ').toLowerCase();
        const precedente = cache.get(chiave);
        if (precedente && precedente.scade > ora()) return structuredClone(precedente.dati);
        if (inCorso.has(chiave)) return structuredClone(await inCorso.get(chiave));
        const lavoro = (async () => {
            const r = await richiesta(`/search/artist?${new URLSearchParams({ q: q.trim(), limit: '10' })}`);
            if (!Array.isArray(r.data) || r.data.length > 10) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
            const dati = r.data.map(v => normalizza(v, ora));
            if (new Set(dati.map(v => v.externalId)).size !== dati.length) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
            cache.delete(chiave);
            if (cache.size >= 100) cache.delete(cache.keys().next().value);
            cache.set(chiave, { scade: ora() + cacheMs, dati });
            return dati;
        })();
        inCorso.set(chiave, lavoro);
        try { return structuredClone(await lavoro); } finally { inCorso.delete(chiave); }
    }
    async function catalogo(percorso) {
        const chiave = `catalogo:${percorso}`;
        const precedente = cache.get(chiave);
        if (precedente && precedente.scade > ora()) return structuredClone(precedente.dati);
        if (inCorso.has(chiave)) return structuredClone(await inCorso.get(chiave));
        const lavoro = richiesta(percorso).then(dati => {
            if (cache.size >= 100) cache.delete(cache.keys().next().value);
            cache.set(chiave, { scade: ora() + 300000, dati });
            return dati;
        });
        inCorso.set(chiave, lavoro);
        try { return structuredClone(await lavoro); } finally { inCorso.delete(chiave); }
    }
    function validaId(id) {
        if (typeof id !== 'string' || !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) throw new ErroreProvider('DEEZER_PARAMETRI', 400);
    }
    return {
        cerca,
        async discografia(id, indice = 0) {
            validaId(id);
            if (!Number.isSafeInteger(indice) || indice < 0 || indice > 1200 || indice % 12 !== 0) throw new ErroreProvider('DEEZER_PARAMETRI', 400);
            const { lista, brano, album } = require('./discografia');
            const [top, uscite] = await Promise.all([
                indice === 0 ? catalogo(`/artist/${id}/top?limit=10`) : null,
                catalogo(`/artist/${id}/albums?limit=12&order=RELEASE_DATE_DESC&index=${indice}`),
            ]);
            const pubblicazioni = lista(uscite, album, 12);
            return { provider: 'deezer', externalId: id, brani: top ? lista(top, brano, 10).dati : [],
                pubblicazioni: pubblicazioni.dati.sort((a, b) => (b.dataPubblicazione ?? '').localeCompare(a.dataPubblicazione ?? '') || Number(b.externalId) - Number(a.externalId)),
                prossimoIndice: uscite.data.length === 12 && indice + 12 < uscite.total && indice + 12 <= 1200 ? indice + 12 : null,
                totale: pubblicazioni.totale, controllatoAt: new Date(ora()).toISOString() };
        },
        async dettaglio(id) {
            validaId(id);
            const dati = normalizza(await richiesta(`/artist/${id}`), ora);
            if (dati.externalId !== id) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
            return dati;
        },
    };
}
module.exports = { creaClient, normalizza, urlSicuro };
