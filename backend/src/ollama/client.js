const { schema, sistema, schemaPerInput } = require('./prompt');
class ErroreOllama extends Error {
    constructor(codice, temporaneo = true, raw = null) { super(codice); this.codice = codice; this.temporaneo = temporaneo; this.raw = raw; }
}
function validaRisposta(raw) {
    let v;
    try { v = JSON.parse(raw); } catch { throw new ErroreOllama('OLLAMA_JSON_INVALIDO', false, raw); }
    if (!v || Array.isArray(v) || typeof v !== 'object' || Object.keys(v).length !== schema.required.length ||
        !schema.required.every(k => Object.hasOwn(v, k)) || !['approva', 'rifiuta'].includes(v.decisione) ||
        typeof v.confidenza !== 'number' || !Number.isFinite(v.confidenza) || v.confidenza < 0 || v.confidenza > 1 ||
        typeof v.artista_corrispondente !== 'boolean' || typeof v.possibile_duplicato !== 'boolean' ||
        typeof v.motivazione !== 'string' || !v.motivazione.trim() || v.motivazione.length > 400) {
        throw new ErroreOllama('OLLAMA_SCHEMA_INVALIDO', false, raw);
    }
    return { ...v, motivazione: v.motivazione.trim() };
}
function creaClient(config, fetchImpl = fetch) {
    async function richiesta(path, corpo) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeout);
        try {
            const r = await fetchImpl(`${config.url}${path}`, { signal: controller.signal,
                ...(corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : {}) });
            if (!r.ok) throw new ErroreOllama(r.status === 404 ? 'OLLAMA_MODELLO_NON_DISPONIBILE' : `OLLAMA_HTTP_${r.status}`);
            // Limitare anche risposte inattese: niente header, credenziali o log della richiesta.
            const testo = await r.text();
            if (testo.length > 65536) throw new ErroreOllama('OLLAMA_RISPOSTA_ECCESSIVA', false);
            try { return JSON.parse(testo); } catch { throw new ErroreOllama('OLLAMA_JSON_HTTP_INVALIDO', false, testo); }
        } catch (e) {
            if (e instanceof ErroreOllama) throw e;
            throw new ErroreOllama(controller.signal.aborted ? 'OLLAMA_TIMEOUT' : 'OLLAMA_RETE');
        } finally { clearTimeout(timer); }
    }
    return {
        async pronto() {
            let r;
            try { r = await richiesta('/api/tags'); } catch (e) { throw new ErroreOllama(e.codice ?? 'OLLAMA_READINESS'); }
            if (!r || !Array.isArray(r.models) || !r.models.some(m => [m.name, m.model].includes(config.modello))) throw new ErroreOllama('OLLAMA_MODELLO_NON_DISPONIBILE');
            return { pronto: true, modello: config.modello };
        },
        async valuta(input) {
            const formato = schemaPerInput(input);
            const r = await richiesta('/api/chat', { model: config.modello, stream: false, think: false,
                format: formato, options: { temperature: 0, num_predict: 512 },
                messages: [{ role: 'system', content: `${sistema}\nJSON Schema: ${JSON.stringify(formato)}` }, { role: 'user', content: JSON.stringify(input) }] });
            const raw = r?.message?.content;
            if (typeof raw !== 'string' || !raw.trim() || r.done !== true) throw new ErroreOllama('OLLAMA_RISPOSTA_ASSENTE', false);
            const risposta = validaRisposta(raw);
            if (!formato.properties.motivazione.enum.includes(JSON.parse(raw).motivazione)) throw new ErroreOllama('OLLAMA_MOTIVAZIONE_FUORI_SCHEMA', false, raw);
            const positiva = formato.properties.motivazione.enum.find(m => m.includes('coerente con l\'identità Ticketmaster'));
            if (risposta.decisione === 'approva' && risposta.motivazione !== positiva) throw new ErroreOllama('OLLAMA_MOTIVAZIONE_INCOERENTE', false, raw);
            return { raw, risposta };
        },
    };
}
module.exports = { creaClient, validaRisposta, ErroreOllama };
