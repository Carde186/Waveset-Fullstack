const { ErroreProvider } = require('./errore');
function providerAttivo(env = process.env) {
    const valore = env.ARTISTI_PROVIDER || 'deezer';
    if (valore !== 'deezer') throw new ErroreProvider('PROVIDER_CONFIGURAZIONE', 503);
    return valore;
}
module.exports = { providerAttivo };
