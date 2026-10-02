// Cookie della sessione browser: lettura, scrittura e cancellazione (funzioni
// pure, nessun I/O). La lettura è usata da trovaSessione e da
// proteggiSessioneCookie; scrittura e cancellazione (Set-Cookie) non sono
// ancora collegate a nessuna route.
//
// Formato: waveset_sid=<device_id>.<token>
//   - device_id: UUID generato dal server (la chiave della riga in `sessioni`);
//   - token: 256 bit in esadecimale minuscolo, uguale a quello delle sessioni
//     bearer (nel DB resta solo il suo SHA-256).
// Attributi: HttpOnly, SameSite=Strict, Path=/api, nessun Domain (cookie
// legato al solo host), Secure secondo la configurazione o se la richiesta è
// HTTPS. Path=/api esclude il prefisso `__Host-`, che richiederebbe Path=/.

const { deviceIdValido } = require('./token');

const NOME_COOKIE = 'waveset_sid';
const PERCORSO_COOKIE = '/api';
const DURATA_SESSIONE_WEB_SEC = 7 * 24 * 60 * 60;

const FORMATO_TOKEN = /^[0-9a-f]{64}$/;
const FORMATO_VALORE = /^([^.]+)\.([0-9a-f]{64})$/;

// Cookie della richiesta (intestazione Cookie). Ritorna:
//   { stato: 'assente' }                       nessun cookie waveset_sid
//   { stato: 'valido', deviceId, token }       formato corretto
//   { stato: 'non_valido', motivo }            duplicato o malformato
// Un cookie duplicato o malformato NON è mai «assente»: chi chiama deve
// trattarlo come non valido (e, per le richieste non sicure, rifiutarlo).
function leggiCookieSessione(intestazione) {
    if (
        intestazione === undefined ||
        intestazione === null ||
        intestazione === ''
    ) {
        return { stato: 'assente' };
    }
    if (typeof intestazione !== 'string') {
        return { stato: 'non_valido', motivo: 'intestazione non testuale' };
    }

    // CR e LF non hanno posto in un'intestazione Cookie (il parser HTTP di
    // Node li rifiuta): se compaiono, l'intestazione è non valida, non
    // «ripulita». Fail-closed anche se il resto sembrerebbe a posto.
    if (/[\r\n]/.test(intestazione)) {
        return {
            stato: 'non_valido',
            motivo: 'caratteri di controllo nell\'intestazione',
        };
    }

    const valori = [];

    for (const parte of intestazione.split(';')) {
        // Ai bordi di ogni coppia si tolgono SOLO spazi e tabulazioni (i
        // separatori ammessi): non trim(), che toglierebbe anche a capo e
        // altri spazi.
        const coppia = parte.replace(/^[ \t]+|[ \t]+$/g, '');

        if (coppia === '') {
            continue;
        }

        const uguale = coppia.indexOf('=');
        const nome = uguale === -1 ? coppia : coppia.slice(0, uguale);

        // I nomi dei cookie distinguono le maiuscole: solo waveset_sid.
        if (nome === NOME_COOKIE) {
            valori.push(uguale === -1 ? null : coppia.slice(uguale + 1));
        }
    }

    if (valori.length === 0) {
        return { stato: 'assente' };
    }
    if (valori.length > 1) {
        return { stato: 'non_valido', motivo: 'cookie duplicato' };
    }

    const trovato = valori[0] === null ? null : FORMATO_VALORE.exec(valori[0]);

    if (!trovato || !deviceIdValido(trovato[1])) {
        return { stato: 'non_valido', motivo: 'cookie malformato' };
    }

    return { stato: 'valido', deviceId: trovato[1], token: trovato[2] };
}

// Secure se la configurazione lo forza OPPURE se la richiesta è HTTPS: su HTTPS
// il cookie è sempre Secure, anche con COOKIE_SECURE=false.
function cookieSicuro({ forzato, richiestaHttps } = {}) {
    return forzato === true || richiestaHttps === true;
}

function attributiComuni(sicuro) {
    return [
        `Path=${PERCORSO_COOKIE}`,
        'HttpOnly',
        'SameSite=Strict',
        ...(sicuro ? ['Secure'] : []),
    ];
}

// Valore dell'intestazione Set-Cookie che crea la sessione web. Valida gli
// ingressi: nessun carattere estraneo (a capo compresi) può finire
// nell'intestazione.
function serializzaCookieSessione({
    deviceId,
    token,
    maxAgeSec = DURATA_SESSIONE_WEB_SEC,
    sicuro = false,
}) {
    if (!deviceIdValido(deviceId)) {
        throw new TypeError('device_id non valido');
    }
    if (typeof token !== 'string' || !FORMATO_TOKEN.test(token)) {
        throw new TypeError('token non valido');
    }
    if (!Number.isInteger(maxAgeSec) || maxAgeSec < 1) {
        throw new TypeError('Max-Age non valido');
    }

    return [
        `${NOME_COOKIE}=${deviceId}.${token}`,
        `Max-Age=${maxAgeSec}`,
        ...attributiComuni(sicuro),
    ].join('; ');
}

// Set-Cookie che cancella il cookie: stesso nome, stesso Path e stessi
// attributi della creazione (un Path diverso non cancellerebbe nulla).
function cancellaCookieSessione({ sicuro = false } = {}) {
    return [
        `${NOME_COOKIE}=`,
        'Max-Age=0',
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        ...attributiComuni(sicuro),
    ].join('; ');
}

module.exports = {
    NOME_COOKIE,
    PERCORSO_COOKIE,
    DURATA_SESSIONE_WEB_SEC,
    leggiCookieSessione,
    serializzaCookieSessione,
    cancellaCookieSessione,
    cookieSicuro,
};
