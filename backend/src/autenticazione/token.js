const crypto = require('crypto');

// 32 byte = 256 bit casuali: impossibili da indovinare, quindi basta uno
// SHA-256 veloce per conservarli (bcrypt serve per le password, che hanno
// poca entropia e vanno rese lente da provare a forza bruta).
function generaToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

// Confronto a tempo costante: con "===" il confronto si ferma al primo
// carattere diverso, e il tempo di risposta rivelerebbe quanti caratteri
// iniziali sono giusti. Entrambi i buffer sono sempre di 32 byte (SHA-256),
// condizione richiesta da timingSafeEqual.
function tokenCorrisponde(token, hashSalvato) {
    const calcolato = Buffer.from(hashToken(token), 'hex');
    const salvato = Buffer.from(hashSalvato, 'hex');

    if (calcolato.length !== salvato.length) {
        return false;
    }

    return crypto.timingSafeEqual(calcolato, salvato);
}

// UUID come quello generato dall'app: tutto il resto viene rifiutato prima di
// arrivare al database.
function deviceIdValido(deviceId) {
    return (
        typeof deviceId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            deviceId,
        )
    );
}

module.exports = { generaToken, hashToken, tokenCorrisponde, deviceIdValido };
