const { normalizzaImmagini, selezionaImmagine } = require('./immagini');
const STATI = new Set(['onsale', 'offsale', 'canceled', 'postponed', 'rescheduled']);
const nome = v => typeof v === 'string' ? v.trim().toLowerCase() : '';
const testo = (v, max) => typeof v === 'string' && v.trim() ? Array.from(v.trim()).slice(0, max).join('') : null;
function giorno(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000')) return null;
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}
function coordinata(v, limite) {
    if (typeof v !== 'number' && (typeof v !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(v))) return null;
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= limite ? Number(n.toFixed(6)) : null;
}
function urlPubblico(v) {
    try {
        const u = new URL(v);
        return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash &&
            /(^|\.)ticketmaster\.[a-z.]+$/.test(u.hostname) ? u.href : null;
    } catch { return null; }
}
function normalizza(raw, artisti) {
    if (!raw || typeof raw.id !== 'string' || !/^[\w-]{1,64}$/.test(raw.id)) return null;
    const attractions = raw._embedded?.attractions;
    if (attractions !== undefined && !Array.isArray(attractions)) return null;
    const lineup = [];
    for (const artista of artisti) {
        const matches = (attractions ?? []).filter(a => a && typeof a.id === 'string' && /^[\w-]{1,64}$/.test(a.id) && (artista.id_ticketmaster ? a.id === artista.id_ticketmaster : nome(artista.nome) && nome(a.name) === nome(artista.nome) && !artisti.some(b => b.id !== artista.id && b.id_ticketmaster === a.id)));
        const nomeUnivoco = artista.id_ticketmaster || artisti.filter(a => !a.id_ticketmaster && nome(a.nome) === nome(artista.nome)).length === 1;
        if (matches.length === 1 && nomeUnivoco) lineup.push({ artista_id: artista.id, id_attraction_ticketmaster: matches[0].id, confermato: Boolean(artista.id_ticketmaster) });
    }
    lineup.sort((a, b) => a.artista_id - b.artista_id);
    const venue = raw._embedded?.venues?.[0];
    const localTime = raw.dates?.start?.localTime;
    const ora = typeof localTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(localTime) ? (localTime.length === 5 ? `${localTime}:00` : localTime) : null;
    return {
        id_esterno: raw.id,
        venue: { id: testo(venue?.id, 64), paese: testo(venue?.country?.name, 100) },
        images: normalizzaImmagini(raw.images),
        immagine: selezionaImmagine(raw.images),
        campi: { titolo: testo(raw.name, 200), data_evento: giorno(raw.dates?.start?.localDate), ora_evento: ora,
            luogo: testo(venue?.name, 200), citta: testo(venue?.city?.name, 100),
            latitudine: coordinata(venue?.location?.latitude, 90), longitudine: coordinata(venue?.location?.longitude, 180) },
        stato_fonte: STATI.has(raw.dates?.status?.code) ? raw.dates.status.code : 'unknown',
        data_incerta: Boolean(raw.dates?.start?.dateTBD || raw.dates?.start?.dateTBA || raw.dates?.start?.timeTBA),
        // Metadati pubblici per la revisione, senza payload grezzo o credenziali.
        attractions: (attractions ?? []).filter(a => a && typeof a.id === 'string' && /^[\w-]{1,64}$/.test(a.id))
            .map(a => ({ id: a.id, nome: testo(a.name, 200), url: urlPubblico(a.url) })),
        lineup,
    };
}
module.exports = { normalizza, giorno };
