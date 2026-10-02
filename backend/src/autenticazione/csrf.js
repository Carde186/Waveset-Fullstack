// Token CSRF legato alla sessione (funzioni pure, nessun I/O).
//
// Il token CSRF è HMAC-SHA256(chiave = token di sessione, messaggio costante):
// - lo può calcolare solo chi conosce il token di sessione, cioè il server (il
//   cookie è HttpOnly: uno script della pagina non lo legge);
// - non richiede colonne nel database né un segreto del server;
// - cambia a ogni nuova sessione e non permette di risalire al token.
// Viene restituito al client nel corpo JSON (mai il token di sessione) e
// rispedito in un'intestazione.

const crypto = require('node:crypto');

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;
const MESSAGGIO = 'waveset:csrf:v1';

// Chiave casuale del processo, solo per confrontare due valori: si confrontano
// gli HMAC di entrambi, sempre di 32 byte, così timingSafeEqual non riceve mai
// lunghezze diverse e la lunghezza del valore presentato non cambia il percorso.
const CHIAVE_CONFRONTO = crypto.randomBytes(32);

function tokenSessioneValido(token) {
    return typeof token === 'string' && FORMATO_TOKEN.test(token);
}

function generaCsrf(tokenSessione) {
    if (!tokenSessioneValido(tokenSessione)) {
        throw new TypeError('token di sessione non valido');
    }

    return crypto
        .createHmac('sha256', tokenSessione)
        .update(MESSAGGIO)
        .digest('hex');
}

function impronta(valore) {
    return crypto
        .createHmac('sha256', CHIAVE_CONFRONTO)
        .update(valore)
        .digest();
}

// true solo se `presentato` è ESATTAMENTE il token CSRF di quella sessione.
// Non lancia mai: un token di sessione non valido o un valore che non è un
// testo (assente, numero, array, oggetto) sono semplicemente falsi.
function csrfValido(tokenSessione, presentato) {
    if (!tokenSessioneValido(tokenSessione) || typeof presentato !== 'string') {
        return false;
    }

    return crypto.timingSafeEqual(
        impronta(generaCsrf(tokenSessione)),
        impronta(presentato),
    );
}

module.exports = { generaCsrf, csrfValido };
