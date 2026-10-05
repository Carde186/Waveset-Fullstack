const { ErroreProvider } = require('../artistiProvider/errore');
const { urlSicuro } = require('./client');
function identita(v, tipo) {
    if (!v || v.type !== tipo || !Number.isSafeInteger(v.id) || v.id <= 0 || typeof v.title !== 'string' || !v.title.trim()) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
    const url = urlSicuro(v.link, ['deezer.com']);
    if (!url || !new RegExp(`/(?:[a-z]{2}/)?${tipo}/${v.id}/?$`).test(new URL(url).pathname)) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
    return { externalId: String(v.id), titolo: v.title, urlDeezer: url };
}
function copertina(v) {
    // Solo artwork delle pubblicazioni, mai picture_* dell'artista.
    for (const campo of ['cover_big', 'cover_medium', 'cover_xl', 'cover_small']) {
        const url = urlSicuro(v?.[campo], ['dzcdn.net']);
        if (url && new URL(url).pathname.includes('/images/cover/')) return url;
    }
    return null;
}
function brano(v) {
    return { ...identita(v, 'track'), copertinaUrl: copertina(v.album),
        artista: typeof v.artist?.name === 'string' ? v.artist.name : null,
        durata: Number.isSafeInteger(v.duration) && v.duration >= 0 ? v.duration : null };
}
function album(v) {
    const data = typeof v.release_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.release_date) && Number.isFinite(Date.parse(v.release_date)) && new Date(v.release_date).toISOString().slice(0, 10) === v.release_date ? v.release_date : null;
    return { ...identita(v, 'album'), copertinaUrl: copertina(v), dataPubblicazione: data,
        tipo: ['album', 'single', 'ep'].includes(v.record_type) ? v.record_type : 'album' };
}
function lista(r, normalizza, limite) {
    if (!Array.isArray(r.data) || r.data.length > limite || !Number.isSafeInteger(r.total) || r.total < 0) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
    const dati = r.data.map(normalizza);
    if (new Set(dati.map(v => v.externalId)).size !== dati.length) throw new ErroreProvider('DEEZER_DATI_INVALIDI');
    return { dati, totale: r.total };
}
module.exports = { brano, album, lista, copertina };
