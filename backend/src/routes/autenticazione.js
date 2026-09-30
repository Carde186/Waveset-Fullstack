const bcrypt = require('bcrypt');
const crypto = require('crypto');
const express = require('express');

const pool = require('../config/database');
const richiediAutenticazione = require('../autenticazione/richiediAutenticazione');
const {
    deviceIdValido,
    generaToken,
    hashToken,
} = require('../autenticazione/token');

const router = express.Router();

const COSTO_BCRYPT = 12;
const DURATA_SESSIONE_GIORNI = 30;

// Hash di una password casuale, usato quando l'email non esiste: il login
// esegue comunque un confronto bcrypt, così un'email inesistente non risponde
// più in fretta di una esistente con password sbagliata (altrimenti il tempo
// di risposta rivelerebbe quali email sono registrate).
const hashFittizio = bcrypt.hash(
    crypto.randomBytes(16).toString('hex'),
    COSTO_BCRYPT,
);

async function login(req, res) {
    const { email, password } = req.body ?? {};
    const deviceId = req.get('X-Device-Id');

    if (!email || !password || !deviceIdValido(deviceId)) {
        res.status(400).json({
            messaggio: 'email, password e X-Device-Id obbligatori',
        });
        return;
    }

    const [righe] = await pool.query(
        'SELECT id, nome, email, password_hash, ruolo FROM utente WHERE email = ?',
        [email],
    );
    const utente = righe[0];

    // bcrypt nativo: il confronto gira nel thread pool di libuv, non blocca
    // l'event loop mentre calcola.
    const passwordCorretta = await bcrypt.compare(
        password,
        utente ? utente.password_hash : await hashFittizio,
    );

    if (!utente || !passwordCorretta) {
        res.status(401).json({ messaggio: 'Email o password errati' });
        return;
    }

    const token = generaToken();

    // Una sola sessione per dispositivo: un nuovo login dallo stesso device
    // sostituisce la riga esistente (anche se era di un altro utente).
    await pool.query(
        `INSERT INTO sessioni (utente_id, hash_token, device_id, scadenza)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY)) AS nuova
         ON DUPLICATE KEY UPDATE
             utente_id = nuova.utente_id,
             hash_token = nuova.hash_token,
             scadenza = nuova.scadenza,
             creata_il = CURRENT_TIMESTAMP`,
        [utente.id, hashToken(token), deviceId, DURATA_SESSIONE_GIORNI],
    );

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

async function utenteCorrente(req, res) {
    const [righe] = await pool.query(
        'SELECT id, nome, email, ruolo FROM utente WHERE id = ?',
        [req.utente.id],
    );

    res.json(righe[0]);
}

async function logout(req, res) {
    await pool.query('DELETE FROM sessioni WHERE id = ?', [req.sessioneId]);

    res.status(204).end();
}

async function logoutTutti(req, res) {
    await pool.query('DELETE FROM sessioni WHERE utente_id = ?', [
        req.utente.id,
    ]);

    res.status(204).end();
}

router.post('/login', login);
router.get('/io', richiediAutenticazione, utenteCorrente);
router.post('/logout', richiediAutenticazione, logout);
router.post('/logout-tutti', richiediAutenticazione, logoutTutti);

module.exports = router;
