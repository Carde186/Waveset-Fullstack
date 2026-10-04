// Solo immagini dichiarate dall'evento Discovery API, mai foto della lineup.
const LARGHEZZA_OBIETTIVO = 1024;
function urlImmagine(valore) {
    if (typeof valore !== 'string') return null;
    try {
        const u = new URL(valore);
        const ufficiale = /(^|\.)ticketm\.net$/.test(u.hostname) || /(^|\.)ticketmaster\.com$/.test(u.hostname);
        if (!ufficiale || !['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.port) return null;
        // Gli esempi ufficiali Discovery usano anche HTTP sul CDN noto.
        u.protocol = 'https:';
        return u.href;
    } catch { return null; }
}
function normalizzaImmagini(images) {
    if (!Array.isArray(images)) return [];
    return images.flatMap(i => {
        if (!i || typeof i !== 'object') return [];
        const url = urlImmagine(i.url);
        if (!url || !Number.isInteger(i.width) || !Number.isInteger(i.height) || i.width < 1 || i.height < 1 || i.width > 20000 || i.height > 20000) return [];
        const rapporto = i.width / i.height;
        const ratio = Math.abs(rapporto / (16 / 9) - 1) < 0.02 ? '16_9'
            : Math.abs(rapporto / (3 / 2) - 1) < 0.02 ? '3_2' : null;
        return [{ url, width: i.width, height: i.height, ratio, fallback: i.fallback === true, source: 'ticketmaster' }];
    });
}
function selezionaImmagine(images) {
    const valide = normalizzaImmagini(images);
    const candidate = valide.some(i => !i.fallback) ? valide.filter(i => !i.fallback) : valide;
    // Orizzontali prima; minima larghezza >=1024, altrimenti la maggiore.
    // A pari dimensioni: 16:9, altezza e URL, indipendentemente dall'ordine API.
    candidate.sort((a, b) => Number(b.ratio !== null) - Number(a.ratio !== null)
        || Number(b.width >= LARGHEZZA_OBIETTIVO) - Number(a.width >= LARGHEZZA_OBIETTIVO)
        || (a.width >= LARGHEZZA_OBIETTIVO ? a.width - b.width : b.width - a.width)
        || Number(b.ratio === '16_9') - Number(a.ratio === '16_9')
        || a.height - b.height || a.url.localeCompare(b.url, 'en'));
    return candidate[0] ?? null;
}
function leggiImmagine(valore) {
    try {
        const i = typeof valore === 'string' ? JSON.parse(valore) : valore;
        return i?.source === 'ticketmaster' ? selezionaImmagine([i]) : null;
    } catch { return null; }
}
module.exports = { normalizzaImmagini, selezionaImmagine, leggiImmagine };
