const { createHash } = require('node:crypto');
const { VERSIONE_PROMPT } = require('./prompt');
const { providerAttivo } = require('../artistiProvider/configurazione');
function json(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }
const testo = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) || null : null;
function url(v) { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash ? u.href : null; } catch { return null; } }
function hash(inputs, modello) {
    return createHash('sha256').update(JSON.stringify({ modello, prompt: VERSIONE_PROMPT,
        inputs: inputs.map(({ eventiRilevanti, ...v }) => v) })).digest('hex');
}
async function preparaInput(db, id, env = process.env) {
    const [[e]] = await db.query(`SELECT e.*,DATE_FORMAT(e.data_evento,'%Y-%m-%d') giorno,
        sf.snapshot,sf.stato_fonte,sf.modifiche_fonte FROM evento e
        LEFT JOIN ticketmaster_evento_fonte sf ON sf.evento_id=e.id WHERE e.id=? AND e.fonte='ticketmaster'`, [id]);
    if (!e) return [];
    const s = json(e.snapshot) ?? {};
    const [artisti] = await db.query(`SELECT a.id,a.nome,a.id_ticketmaster,l.external_id,l.url,l.dati_normalizzati_json,
        p.esito_json FROM evento_artista ea JOIN artista a ON a.id=ea.artista_id
        LEFT JOIN artista_provider_link l ON l.artista_id=a.id AND l.provider=?
        LEFT JOIN artista_ticketmaster_presenza p ON p.link_id=l.id AND p.external_id=l.external_id AND p.storefront=l.storefront
        WHERE ea.evento_id=? ORDER BY a.id`, [providerAttivo(env), id]);
    const inputs = [];
    for (const a of artisti.length ? artisti : [{ id: null, nome: null }]) {
        const profilo = json(a.dati_normalizzati_json) ?? {};
        const presenza = json(a.esito_json) ?? {};
        const [doppi] = a.id ? await db.query(`SELECT e.id,e.id_esterno,e.titolo,DATE_FORMAT(e.data_evento,'%Y-%m-%d') data,e.luogo venue
            FROM evento e
            WHERE e.id<>? AND e.data_evento=? AND LOWER(TRIM(COALESCE(e.luogo,'')))=LOWER(TRIM(COALESCE(?,'')))
            AND e.stato='pubblicato' AND (e.fonte<>'ticketmaster' OR EXISTS(SELECT 1 FROM ollama_evento_job j WHERE j.evento_id=e.id AND j.stato='approva'))
            AND NOT EXISTS(SELECT 1 FROM ticketmaster_evento_fonte sf WHERE sf.evento_id=e.id AND sf.stato_fonte='canceled') ORDER BY e.id LIMIT 20`,
            [id, e.giorno, e.luogo]) : [[]];
        inputs.push({ artista: { id: a.id, nome: testo(a.nome), nomeProvider: testo(profilo.name), provider: providerAttivo(env),
            providerExternalId: testo(a.external_id, 64), url: url(a.url),
            ...(Number.isSafeInteger(profilo.fan) ? { fan: profilo.fan } : {}),
            ...(Array.isArray(profilo.genres) && profilo.genres.length ? { generi: profilo.genres.filter(g => typeof g === 'string').slice(0, 20).map(g => testo(g)) } : {}) },
            verificaTicketmaster: { stato: ['trovato', 'non_trovato', 'non_verificato'].includes(presenza.stato) ? presenza.stato : 'non_verificato',
                attractionConfermata: testo(a.id_ticketmaster, 64), omonimi: Boolean(presenza.ambiguo),
                attractions: (Array.isArray(presenza.attractions) ? presenza.attractions : []).slice(0, 20).map(v => ({ id: testo(v.id, 64), nome: testo(v.name ?? v.nome) })) },
            evento: { id: testo(e.id_esterno, 64), titolo: testo(e.titolo), data: e.giorno, ora: testo(e.ora_evento, 8),
                venue: testo(e.luogo), citta: testo(e.citta), paese: testo(s.venue?.paese, 100),
                statoFonte: e.stato_fonte ?? 'unknown', dataIncerta: Boolean(s.data_incerta),
                contraddizioni: Boolean(e.modifiche_fonte),
                attractions: (Array.isArray(s.attractions) ? s.attractions : []).slice(0, 100).map(v => ({ id: testo(v.id, 64), nome: testo(v.nome) })),
                lineup: artisti.map(v => testo(v.nome)) }, eventiRilevanti: doppi });
    }
    return inputs;
}
module.exports = { preparaInput, hash, json };
