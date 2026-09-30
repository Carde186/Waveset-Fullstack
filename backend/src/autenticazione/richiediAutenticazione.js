const trovaSessione = require('./trovaSessione');

// Nessun try/catch: con Express 5 un errore del database arriva da solo a
// gestisciErrore (vedi app.js).
async function richiediAutenticazione(req, res, next) {
    const sessione = await trovaSessione(req);

    // Stessa risposta per ogni motivo di rifiuto (token mancante, sbagliato,
    // scaduto, device_id che non combacia): il client non deve poter capire
    // quale controllo è fallito.
    if (!sessione) {
        res.status(401).json({ messaggio: 'Sessione non valida' });
        return;
    }

    req.utente = sessione.utente;
    req.sessioneId = sessione.id;
    next();
}

module.exports = richiediAutenticazione;
