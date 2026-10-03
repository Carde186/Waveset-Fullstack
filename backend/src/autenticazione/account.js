const { validaEmail, validaPassword } = require('./registrazione');

function validaCambio(corpo, tipo) {
    const email = tipo === 'email';
    const campo = email ? 'nuovaEmail' : 'nuovaPassword';
    const conferma = email ? 'confermaEmail' : 'confermaPassword';
    const ammessi = ['passwordCorrente', campo, conferma];
    const campi = {};
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo) ||
        Object.keys(corpo).some(k => !ammessi.includes(k))) {
        return { ok: false, campi: { corpo: 'INVALID_INPUT' } };
    }
    if (typeof corpo.passwordCorrente !== 'string' || !corpo.passwordCorrente ||
        corpo.passwordCorrente.includes('\0') || Buffer.byteLength(corpo.passwordCorrente, 'utf8') > 72) {
        campi.passwordCorrente = 'REQUIRED';
    }
    const errori = {};
    const nuovo = email ? validaEmail(corpo[campo], errori) : validaPassword(corpo[campo], errori);
    if (nuovo === null || (!email && (!/\p{L}/u.test(nuovo) || !/[\p{N}\p{P}\p{S}]/u.test(nuovo)))) {
        campi[campo] = email ? 'INVALID_EMAIL' : 'INVALID_PASSWORD';
    }
    const ripetuto = typeof corpo[conferma] === 'string'
        ? (email ? corpo[conferma].trim().toLowerCase() : corpo[conferma]) : null;
    if (nuovo === null || ripetuto !== nuovo) campi[conferma] = 'MISMATCH';
    return Object.keys(campi).length ? { ok: false, campi }
        : { ok: true, dati: { passwordCorrente: corpo.passwordCorrente, nuovo } };
}

module.exports = { validaCambio };
