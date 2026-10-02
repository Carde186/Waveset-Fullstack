const bcrypt = require('bcrypt');
const crypto = require('crypto');
const express = require('express');

const pool = require('../config/database');
const richiediAutenticazione = require('../autenticazione/richiediAutenticazione');
const {
    DURATA_SESSIONE_WEB_SEC,
    cancellaCookieSessione,
    cookieSicuro,
    leggiCookieSessione,
    serializzaCookieSessione,
} = require('../autenticazione/cookieSessione');
const { generaCsrf } = require('../autenticazione/csrf');
const { MESSAGGIO_429 } = require('../autenticazione/limiteRichieste');
const { origineAmmessa } = require('../autenticazione/origini');
const { MESSAGGIO_403 } = require('../autenticazione/proteggiSessioneCookie');
const { validaRegistrazione } = require('../autenticazione/registrazione');
const {
    deviceIdValido,
    generaToken,
    hashToken,
} = require('../autenticazione/token');

const router = express.Router();

const COSTO_BCRYPT = 12;
// Sessioni bearer (app Android): 30 giorni, invariati.
const DURATA_SESSIONE_GIORNI = 30;
// Sessioni del browser: 7 giorni, gli stessi secondi del Max-Age del cookie.
const DURATA_SESSIONE_WEB_GIORNI = DURATA_SESSIONE_WEB_SEC / (24 * 60 * 60);

// Secure del cookie di sessione: UNA sola regola, usata sia per crearlo (login
// web) sia per cancellarlo (logout), così gli attributi coincidono e il browser
// riconosce lo stesso cookie.
function cookieSessioneSicuro(req) {
    return cookieSicuro({
        forzato: req.app.locals.configurazioneWeb?.cookieSicuroForzato,
        richiestaHttps: req.secure,
    });
}

// Crea (o sostituisce, se il device_id esiste già) la riga di una sessione.
// Condivisa dai due login: cambia solo la durata.
async function inserisciSessione({ utenteId, deviceId, token, giorni }) {
    await pool.query(
        `INSERT INTO sessioni (utente_id, hash_token, device_id, scadenza)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY)) AS nuova
         ON DUPLICATE KEY UPDATE
             utente_id = nuova.utente_id,
             hash_token = nuova.hash_token,
             scadenza = nuova.scadenza,
             creata_il = CURRENT_TIMESTAMP`,
        [utenteId, hashToken(token), deviceId, giorni],
    );
}

// Hash di una password casuale, usato quando l'email non esiste: il login
// esegue comunque un confronto bcrypt, così un'email inesistente non risponde
// più in fretta di una esistente con password sbagliata (altrimenti il tempo
// di risposta rivelerebbe quali email sono registrate).
const hashFittizio = bcrypt.hash(
    crypto.randomBytes(16).toString('hex'),
    COSTO_BCRYPT,
);

// Registrazione di un nuovo utente. Il ruolo è SEMPRE 'USER', scritto qui dal
// server: il corpo ammette solo nome, email e password (validaRegistrazione).
// Non apre nessuna sessione: il client fa poi il login.
//
// Limiti noti, da non nascondere:
// - Enumerazione: il 409 rivela che un'email è già registrata. L'hash bcrypt
//   si calcola prima dell'INSERT per non far dipendere il lavoro dal
//   duplicato, ma questo NON rende i tempi indistinguibili né elimina
//   l'enumerazione.
// - Nessun rate limit (rinviato): accettabile solo con l'endpoint raggiungibile
//   da localhost, obbligatorio prima di esporlo in rete (bcrypt costa CPU).
async function registrazione(req, res) {
    const esito = validaRegistrazione(req.body);

    if (!esito.ok) {
        res.status(400).json({ messaggio: 'Dati non validi', campi: esito.campi });
        return;
    }

    const { nome, email, password } = esito.dati;
    const hash = await bcrypt.hash(password, COSTO_BCRYPT);

    try {
        const [risultato] = await pool.query(
            "INSERT INTO utente (nome, email, password_hash, ruolo) VALUES (?, ?, ?, 'USER')",
            [nome, email, hash],
        );

        res.status(201).json({
            utente: { id: risultato.insertId, nome, email, ruolo: 'USER' },
        });
    } catch (errore) {
        // L'unico vincolo UNIQUE di utente (oltre alla chiave primaria) è
        // l'email: il controllo sta nel database, quindi due registrazioni
        // parallele con la stessa email non passano entrambe.
        if (errore.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ messaggio: 'Email già registrata' });
            return;
        }

        // L'errore originale del driver contiene l'SQL con email e hash: nei
        // log finisce solo il codice.
        throw new Error(
            `Registrazione: errore database (${errore.code ?? 'sconosciuto'})`,
        );
    }
}

async function login(req, res) {
    const { email, password } = req.body ?? {};
    const deviceId = req.get('X-Device-Id');

    // Solo stringhe: un oggetto, un array o un numero al posto di email o
    // password non sono credenziali (prima davano un 401 e, per la password,
    // un 500 di bcrypt). Il messaggio del 400 non cambia.
    if (
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        !email ||
        !password ||
        !deviceIdValido(deviceId)
    ) {
        res.status(400).json({
            messaggio: 'email, password e X-Device-Id obbligatori',
        });
        return;
    }

    // Limiti sul login (vedi limiteLogin.js): si conta PRIMA di bcrypt e non si
    // arriva alla query né al confronto se un limite è raggiunto. Il 429 è
    // l'unica aggiunta al contratto: 200, 400 e 401 restano quelli di prima.
    const { limitiLogin, ricavaIp } = req.app.locals;
    const tentativo = limitiLogin.inizia(ricavaIp(req), email);

    if (!tentativo.consentito) {
        res.set('Retry-After', String(tentativo.retryAfterSec));
        res.status(429).json({ messaggio: MESSAGGIO_429 });
        return;
    }

    let utente;
    let token;

    try {
        const [righe] = await pool.query(
            'SELECT id, nome, email, password_hash, ruolo FROM utente WHERE email = ?',
            [email],
        );
        utente = righe[0];

        // bcrypt nativo: il confronto gira nel thread pool di libuv, non
        // blocca l'event loop mentre calcola.
        const passwordCorretta = await bcrypt.compare(
            password,
            utente ? utente.password_hash : await hashFittizio,
        );

        if (!utente || !passwordCorretta) {
            // Il tentativo resta contato come fallimento (email inesistenti
            // comprese: nessuna differenza osservabile).
            res.status(401).json({ messaggio: 'Email o password errati' });
            return;
        }

        token = generaToken();

        // Una sola sessione per dispositivo: un nuovo login dallo stesso
        // device sostituisce la riga esistente (anche se era di un altro
        // utente).
        await inserisciSessione({
            utenteId: utente.id,
            deviceId,
            token,
            giorni: DURATA_SESSIONE_GIORNI,
        });
    } catch (errore) {
        // Un guasto del server (es. database) non è un tentativo del client.
        tentativo.errore();
        throw errore;
    }

    tentativo.riuscito();

    // Unica volta in cui il token esce dal server: da qui in poi esiste solo
    // come hash nel database.
    res.json({
        token,
        utente: {
            id: utente.id,
            nome: utente.nome,
            email: utente.email,
            ruolo: utente.ruolo,
        },
    });
}

// Revoca la sessione web PRECEDENTE del browser, se la richiesta ne porta una.
// Si chiama SOLO dopo che il nuovo login è riuscito e la nuova sessione è stata
// creata (un login fallito, bloccato o rifiutato non tocca la vecchia).
//
// Si cancella la sola riga che il cookie identifica per device_id E hash del
// token: chi non ha il token non può revocare la sessione altrui. Non si
// revoca nient'altro dell'utente (le sessioni Android restano); la tabella non
// ha una colonna per il canale, quindi non distingue una sessione web da una
// bearer se qualcuno ne presentasse il token come cookie. Un cookie assente,
// duplicato o malformato non revoca nulla e non impedisce il login. Un guasto
// nella revoca non fa fallire il login già riuscito: si registra il solo codice.
async function revocaSessioneWebPrecedente(req) {
    const cookie = leggiCookieSessione(req.get('Cookie'));

    if (cookie.stato !== 'valido') {
        return;
    }

    try {
        await pool.query(
            'DELETE FROM sessioni WHERE device_id = ? AND hash_token = ?',
            [cookie.deviceId, hashToken(cookie.token)],
        );
    } catch (errore) {
        console.error(
            `web/login: revoca della sessione precedente non riuscita (${errore.code ?? 'errore'})`,
        );
    }
}

// Login del browser: sessione nuova di 7 giorni, consegnata SOLO nel cookie
// (HttpOnly). Il corpo JSON contiene l'utente e il token CSRF, mai il token di
// sessione né il suo hash. Ordine dei controlli, dal più economico:
//   1. sessione web non configurata -> 503, nessuna sessione né cookie;
//   2. Origin presente e ammesso     -> 403, prima di corpo, DB, bcrypt e limiti;
//   3. email e password stringhe     -> 400;
//   4. limiti condivisi col login bearer (stessi contatori) -> 429;
//   5. credenziali (bcrypt)           -> 401 uguale a quello del bearer;
//   6. sessione nuova, cookie, e solo ORA revoca della sessione web precedente.
// L'intestazione X-Device-Id non serve e viene ignorata: il device_id lo genera
// il server. Questa route è l'unica esente dal controllo CSRF del middleware, per
// non far dipendere un nuovo login da un cookie vecchio (la difesa qui è
// l'Origin, più SameSite=Strict e il corpo JSON).
async function loginWeb(req, res) {
    res.set('Cache-Control', 'no-store');

    const web = req.app.locals.configurazioneWeb;

    if (!web?.abilitata) {
        res.status(503).json({ messaggio: 'Sessione browser non disponibile' });
        return;
    }

    if (!origineAmmessa(req.get('Origin'), web.origini)) {
        res.status(403).json({ messaggio: MESSAGGIO_403 });
        return;
    }

    const { email, password } = req.body ?? {};

    if (
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        !email ||
        !password
    ) {
        res.status(400).json({ messaggio: 'email e password obbligatori' });
        return;
    }

    const { limitiLogin, ricavaIp } = req.app.locals;
    const tentativo = limitiLogin.inizia(ricavaIp(req), email);

    if (!tentativo.consentito) {
        res.set('Retry-After', String(tentativo.retryAfterSec));
        res.status(429).json({ messaggio: MESSAGGIO_429 });
        return;
    }

    let utente;
    let deviceId;
    let token;

    try {
        const [righe] = await pool.query(
            'SELECT id, nome, email, password_hash, ruolo FROM utente WHERE email = ?',
            [email],
        );
        utente = righe[0];

        const passwordCorretta = await bcrypt.compare(
            password,
            utente ? utente.password_hash : await hashFittizio,
        );

        if (!utente || !passwordCorretta) {
            res.status(401).json({ messaggio: 'Email o password errati' });
            return;
        }

        // device_id e token nuovi, generati qui: mai presi dal client.
        deviceId = crypto.randomUUID();
        token = generaToken();

        await inserisciSessione({
            utenteId: utente.id,
            deviceId,
            token,
            giorni: DURATA_SESSIONE_WEB_GIORNI,
        });
    } catch (errore) {
        tentativo.errore();
        throw errore;
    }

    tentativo.riuscito();

    // Solo dopo il successo: la vecchia sessione web del browser (se c'è).
    await revocaSessioneWebPrecedente(req);

    res.set(
        'Set-Cookie',
        serializzaCookieSessione({
            deviceId,
            token,
            maxAgeSec: DURATA_SESSIONE_WEB_SEC,
            sicuro: cookieSessioneSicuro(req),
        }),
    );
    res.json({
        utente: {
            id: utente.id,
            nome: utente.nome,
            email: utente.email,
            ruolo: utente.ruolo,
        },
        csrf: generaCsrf(token),
    });
}

// Utente della sessione. Con il BEARER la risposta è quella di sempre (i dati
// dell'utente, senza altro). Con il COOKIE si aggiunge il token CSRF, così il
// browser lo recupera dopo un ricarico (lo riceve anche dal login web): la
// risposta è { utente, csrf }, la stessa forma del login web, con
// Cache-Control: no-store. Il token CSRF è derivato dal token che il client ha
// presentato: non si restituisce mai il token di sessione, il suo hash né altro.
async function utenteCorrente(req, res) {
    const [righe] = await pool.query(
        'SELECT id, nome, email, ruolo FROM utente WHERE id = ?',
        [req.utente.id],
    );

    if (req.viaSessione !== 'cookie') {
        res.json(righe[0]);
        return;
    }

    // Sessione arrivata dal cookie: trovaSessione l'ha già validato.
    const cookie = leggiCookieSessione(req.get('Cookie'));

    res.set('Cache-Control', 'no-store');
    res.json({ utente: righe[0], csrf: generaCsrf(cookie.token) });
}

// Con la sessione arrivata dal COOKIE, la risposta cancella anche il cookie, con
// gli stessi attributi usati per crearlo (stesso nome, Path e Secure). Con il
// bearer non si imposta nessun cookie: il contratto dell'app Android non cambia.
function cancellaCookieSeDaBrowser(req, res) {
    if (req.viaSessione === 'cookie') {
        res.set('Cache-Control', 'no-store');
        res.set(
            'Set-Cookie',
            cancellaCookieSessione({ sicuro: cookieSessioneSicuro(req) }),
        );
    }
}

// Chiude SOLO la sessione con cui è arrivata la richiesta (riga trovata da
// device_id e token): le altre sessioni dell'utente restano.
async function logout(req, res) {
    await pool.query('DELETE FROM sessioni WHERE id = ?', [req.sessioneId]);

    cancellaCookieSeDaBrowser(req, res);
    res.status(204).end();
}

async function logoutTutti(req, res) {
    await pool.query('DELETE FROM sessioni WHERE utente_id = ?', [
        req.utente.id,
    ]);

    cancellaCookieSeDaBrowser(req, res);
    res.status(204).end();
}

router.post('/registrazione', registrazione);
router.post('/login', login);
router.post('/web/login', loginWeb);
router.get('/io', richiediAutenticazione, utenteCorrente);
router.post('/logout', richiediAutenticazione, logout);
router.post('/logout-tutti', richiediAutenticazione, logoutTutti);

module.exports = router;
