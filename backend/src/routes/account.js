const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../config/database');
const richiediAutenticazione = require('../autenticazione/richiediAutenticazione');
const richiediRuolo = require('../autenticazione/richiediRuolo');
const { validaCambio } = require('../autenticazione/account');
const { MESSAGGIO_429 } = require('../autenticazione/limiteRichieste');

const router = express.Router();
function limitaAccount(req, res, next) {
    res.set('Cache-Control', 'no-store');
    const limite = req.app.locals.limitiAccount.prenota(String(req.utente.id));
    if (!limite.consentito) {
        res.set('Retry-After', String(limite.retryAfterSec));
        return res.status(429).json({ messaggio: MESSAGGIO_429 });
    }
    next();
}

function cambia(tipo) {
    return async (req, res) => {
        const esito = validaCambio(req.body, tipo);
        if (!esito.ok) return res.status(400).json({ codice: 'INVALID_INPUT', campi: esito.campi });
        try {
            const [righe] = await pool.query(
                'SELECT id, nome, email, password_hash, ruolo FROM utente WHERE id = ?', [req.utente.id],
            );
            const utente = righe[0];
            if (!utente) return res.status(401).json({ codice: 'SESSION_EXPIRED' });
            if (!await bcrypt.compare(esito.dati.passwordCorrente, utente.password_hash)) {
                return res.status(400).json({ codice: 'CURRENT_PASSWORD_INVALID' });
            }
            const valore = tipo === 'email' ? esito.dati.nuovo : await bcrypt.hash(esito.dati.nuovo, 12);
            // Colonna scelta solo dal server. L'identità viene dalla sessione.
            // Il confronto dell'hash protegge da un cambio password concorrente;
            // UNIQUE(email) protegge anche dalle richieste parallele duplicate.
            const colonna = tipo === 'email' ? 'email' : 'password_hash';
            const [risultato] = await pool.query(
                `UPDATE utente SET ${colonna} = ? WHERE id = ? AND password_hash = ? AND ruolo = 'USER'`,
                [valore, req.utente.id, utente.password_hash],
            );
            if (!risultato.affectedRows) return res.status(409).json({ codice: 'ACCOUNT_CHANGED' });
            // Sessioni e CSRF restano validi: nessuna creazione/revoca o cookie nuovo.
            if (tipo === 'password') return res.status(204).end();
            res.json({ utente: { id: utente.id, nome: utente.nome, email: valore, ruolo: utente.ruolo } });
        } catch (errore) {
            if (tipo === 'email' && errore.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ codice: 'EMAIL_EXISTS' });
            }
            // Il driver può includere SQL, email e hash: non propagare l'errore originale.
            throw new Error('Aggiornamento account non riuscito');
        }
    };
}
const protezioni = [richiediAutenticazione, richiediRuolo('USER'), limitaAccount];
router.patch('/email', ...protezioni, cambia('email'));
router.patch('/password', ...protezioni, cambia('password'));
module.exports = router;
