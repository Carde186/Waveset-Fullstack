// Va montato DOPO richiediAutenticazione (si aspetta req.utente già
// popolato). Primo middleware di ruolo del progetto: finora ogni route
// protetta bastava fosse autenticata, nessuna era riservata all'ADMIN.
function richiediRuolo(ruolo) {
    return function (req, res, next) {
        if (req.utente.ruolo !== ruolo) {
            res.status(403).json({ messaggio: 'Permesso negato' });
            return;
        }
        next();
    };
}

module.exports = richiediRuolo;
