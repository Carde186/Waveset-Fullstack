// Configurazione della sessione browser, letta dall'ambiente (nessun I/O).
//
// Non lancia MAI e non impedisce l'avvio del backend: una configurazione non
// valida (o assente) DISABILITA solo la sessione web, con i motivi elencati; il
// login bearer dell'app Android non ne dipende. Nessuna origine viene
// accettata a metà: o tutte valide, o nessuna.
//
// Variabili:
//   FRONTEND_ORIGINS  origini ammesse, separate da virgole (vedi origini.js)
//   COOKIE_SECURE     'true' forza l'attributo Secure; 'false' o assente lo
//                     lascia a HTTPS (su una richiesta HTTPS il cookie è
//                     comunque Secure). Altri valori: configurazione non valida.
//   NODE_ENV          con 'production' serve COOKIE_SECURE=true, perché dietro
//                     un proxy TLS (trust proxy disattivato) il backend non
//                     vede l'HTTPS: senza, la sessione web resta disabilitata.

const { parseOrigini } = require('./origini');

const MAX_TESTO_ERRORE = 100;

function troncato(testo) {
    const s = String(testo);

    return s.length > MAX_TESTO_ERRORE ? `${s.slice(0, MAX_TESTO_ERRORE)}…` : s;
}

function leggiCookieSecure(valore, motivi) {
    if (valore === undefined || valore === null || valore === '') {
        return false;
    }
    if (valore === 'true') {
        return true;
    }
    if (valore === 'false') {
        return false;
    }

    motivi.push(
        `COOKIE_SECURE non valido: "${troncato(valore)}" (ammessi: true, false)`,
    );
    return false;
}

// Ritorna { abilitata, origini: Set, cookieSicuroForzato, motivi: [testo] }.
function configurazioneWebDaAmbiente(env = process.env) {
    const motivi = [];
    const sorgente = env !== null && typeof env === 'object' ? env : {};

    const { presente, origini, errori } = parseOrigini(sorgente.FRONTEND_ORIGINS);

    if (!presente && errori.length === 0) {
        motivi.push('FRONTEND_ORIGINS non impostata');
    }
    for (const errore of errori) {
        motivi.push(`FRONTEND_ORIGINS: ${errore}`);
    }

    const cookieSicuroForzato = leggiCookieSecure(
        sorgente.COOKIE_SECURE,
        motivi,
    );

    if (sorgente.NODE_ENV === 'production' && !cookieSicuroForzato) {
        motivi.push('in produzione COOKIE_SECURE deve essere true');
    }

    const abilitata = motivi.length === 0;

    return {
        abilitata,
        origini: abilitata ? origini : new Set(),
        cookieSicuroForzato,
        motivi,
    };
}

module.exports = { configurazioneWebDaAmbiente };
