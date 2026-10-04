const { createPrivateKey, sign } = require('node:crypto');
const { ErroreAppleMusic } = require('./errore');

// Validazione al primo uso: il catalogo locale resta disponibile senza Apple.
function configurazione(env = process.env) {
    try {
        const teamId = env.APPLE_MUSIC_TEAM_ID;
        const keyId = env.APPLE_MUSIC_KEY_ID;
        const storefront = env.APPLE_MUSIC_STOREFRONT;
        const ttl = Number(env.APPLE_MUSIC_TOKEN_TTL || 3600);
        const timeout = Number(env.APPLE_MUSIC_TIMEOUT_MS || 10000);
        if (!/^[A-Z0-9]{10}$/.test(teamId || '') || !/^[A-Z0-9]{10}$/.test(keyId || '') ||
            !/^[a-z]{2}$/.test(storefront || '') ||
            !Number.isInteger(ttl) || ttl < 60 || ttl > 15777000 ||
            !Number.isInteger(timeout) || timeout < 10 || timeout > 60000 || !env.APPLE_MUSIC_PRIVATE_KEY) throw new Error();
        const key = createPrivateKey(env.APPLE_MUSIC_PRIVATE_KEY.replace(/\\n/g, '\n'));
        if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
        return { teamId, keyId, key, storefront, ttl, timeout };
    } catch {
        // Mai propagare PEM, identificatori o messaggi della libreria crypto.
        throw new ErroreAppleMusic('APPLE_CONFIGURAZIONE', 503);
    }
}

function creaToken(config, ora = () => Date.now()) {
    let cache = null;
    return {
        leggi() {
            const iat = Math.floor(ora() / 1000);
            if (cache && iat >= cache.iat && iat < cache.exp - Math.min(30, config.ttl / 4)) return cache.valore;
            const exp = iat + config.ttl;
            const codifica = v => Buffer.from(JSON.stringify(v)).toString('base64url');
            const dati = `${codifica({ alg: 'ES256', kid: config.keyId })}.${codifica({ iss: config.teamId, iat, exp })}`;
            try {
                const firma = sign('sha256', Buffer.from(dati), { key: config.key, dsaEncoding: 'ieee-p1363' });
                cache = { valore: `${dati}.${firma.toString('base64url')}`, iat, exp };
                return cache.valore;
            } catch {
                throw new ErroreAppleMusic('APPLE_CONFIGURAZIONE', 503);
            }
        },
        invalida() { cache = null; },
    };
}
module.exports = { configurazione, creaToken };
