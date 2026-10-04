const { providerAttivo } = require('./configurazione');

// Unica priorità pubblica: provider attivo, immagine locale, nessuna foto.
// Non si consulta un provider alternativo e non si modifica il catalogo.
function scegliImmagine(collegata, locale) {
    const presente = v => typeof v === 'string' && v.trim() ? v.trim() : null;
    return presente(collegata) ?? presente(locale);
}
async function immaginiArtisti(righe, { campoId = 'id', campoImmagine = 'immagine_url',
    pool = require('../config/database'), env = process.env } = {}) {
    const ids = [...new Set(righe.map(r => Number(r[campoId])).filter(id => Number.isSafeInteger(id) && id > 0))];
    if (!ids.length) return righe;
    const provider = providerAttivo(env);
    let collegamenti;
    try {
        [collegamenti] = await pool.query('SELECT artista_id, immagine_url FROM artista_provider_link WHERE provider=? AND artista_id IN (?)', [provider, ids]);
    } catch (e) {
        // Un vecchio volume senza tabella provider conserva le foto locali.
        if (e.code !== 'ER_NO_SUCH_TABLE') throw new Error('Lettura immagini artista non riuscita');
        collegamenti = [];
    }
    const immagini = new Map(collegamenti.map(r => [Number(r.artista_id), r.immagine_url]));
    return righe.map(r => {
        const collegata = scegliImmagine(immagini.get(Number(r[campoId])), null);
        return { ...r, [campoImmagine]: scegliImmagine(collegata, r[campoImmagine]), immagine_provider: collegata ? provider : null };
    });
}
module.exports = { immaginiArtisti, scegliImmagine };
