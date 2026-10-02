// Protezione delle richieste che MODIFICANO dati quando la sessione arriva dal
// cookie del browser (CSRF + Origin). Montato su /api, prima del parsing del
// corpo e di qualunque route.
//
// Una richiesta non sicura (metodo diverso da GET, HEAD, OPTIONS) che porta il
// cookie di sessione deve avere:
//   - un'intestazione Origin ESATTAMENTE fra quelle ammesse (FRONTEND_ORIGINS);
//   - un'intestazione X-CSRF-Token uguale al token CSRF di quella sessione.
// Altrimenti 403, SEMPRE: anche sulle route pubbliche, anche su quelle con
// autenticazione facoltativa e anche su URL inesistenti. Non prosegue mai come
// utente anonimo: un cookie di sessione che non supera il controllo è un
// tentativo di usare una sessione, non l'assenza di sessione.
//
// Non fa nulla (la richiesta passa com'era) quando:
// - la sessione web non è configurata: il cookie non autentica nessuno, quindi
//   non c'è nulla da proteggere;
// - il metodo è sicuro (GET, HEAD, OPTIONS: nessuna modifica);
// - c'è l'intestazione Authorization: è il trasporto bearer (l'app Android),
//   un browser non la aggiunge da solo a una richiesta cross-site;
// - non c'è nessun cookie waveset_sid (una richiesta anonima o solo bearer).
// Un cookie waveset_sid duplicato o malformato NON conta come assente: su una
// richiesta non sicura dà 403.

const { leggiCookieSessione } = require('./cookieSessione');
const { csrfValido } = require('./csrf');
const { origineAmmessa } = require('./origini');

const METODI_SICURI = new Set(['GET', 'HEAD', 'OPTIONS']);
const MESSAGGIO_403 = 'Richiesta non consentita';

// UNICA eccezione: il login del browser. Prima del login non esiste ancora un
// token CSRF, e un cookie vecchio (scaduto, revocato, di un altro utente) non
// deve impedire un nuovo login. La sua difesa è propria: Origin obbligatorio e
// ammesso (controllato per primo nel gestore), SameSite=Strict e corpo JSON.
// Confronto ESATTO su metodo e percorso: qualunque variante (maiuscole, barra
// finale, sottopercorsi) NON è esente e resta protetta.
const METODO_ESENTE = 'POST';
const PERCORSO_ESENTE = '/api/auth/web/login';

function proteggiSessioneCookie(req, res, next) {
    const web = req.app?.locals?.configurazioneWeb;

    if (!web?.abilitata || METODI_SICURI.has(req.method)) {
        next();
        return;
    }
    if (
        req.method === METODO_ESENTE &&
        `${req.baseUrl ?? ''}${req.path ?? ''}` === PERCORSO_ESENTE
    ) {
        next();
        return;
    }
    if (req.get('Authorization') !== undefined) {
        next();
        return;
    }

    const cookie = leggiCookieSessione(req.get('Cookie'));

    if (cookie.stato === 'assente') {
        next();
        return;
    }

    // Stessa risposta per ogni motivo di rifiuto (cookie non valido, Origin
    // mancante o errato, token CSRF mancante o errato): il client non deve
    // poter capire quale controllo è fallito.
    if (
        cookie.stato !== 'valido' ||
        !origineAmmessa(req.get('Origin'), web.origini) ||
        !csrfValido(cookie.token, req.get('X-CSRF-Token'))
    ) {
        res.status(403).json({ messaggio: MESSAGGIO_403 });
        return;
    }

    next();
}

module.exports = { proteggiSessioneCookie, MESSAGGIO_403 };
