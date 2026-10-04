const { ErroreAppleMusic } = require('../appleMusic/errore');
function providerAttivo(env = process.env) {
    const valore = env.ARTISTI_PROVIDER || 'deezer';
    if (!['deezer', 'apple_music'].includes(valore)) throw new ErroreAppleMusic('PROVIDER_CONFIGURAZIONE', 503);
    return valore;
}
module.exports = { providerAttivo };
