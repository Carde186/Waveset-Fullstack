const biografie = require('./biografie.json');

// Le bio curate nel DB prevalgono. I testi editoriali sono un fallback
// verificabile, non dati attribuiti al provider né scritture sul catalogo.
function biografia(nome, bio) {
    return typeof bio === 'string' && bio.trim() ? null : biografie[nome] ?? null;
}
function popolaritaDeezer(profilo) {
    if (!profilo) return null;
    const fan = Number.isSafeInteger(profilo.fan) && profilo.fan >= 0 ? profilo.fan : null;
    return fan === null ? null : {
        fan,
        url: profilo.url,
        aggiornato_at: profilo.syncedAt,
    };
}
module.exports = { biografia, popolaritaDeezer };
