const trovaSessione = require('./trovaSessione');

// Per le route pubbliche che si arricchiscono se l'utente è loggato (es. il
// flag "seguito" nel dettaglio artista, il feed Novità personalizzato): con
// una sessione valida imposta req.utente, altrimenti lascia passare da
// anonimi. Una sessione non valida non dà 401 qui: il catalogo resta
// consultabile, e sarà la prossima route protetta a chiudere la sessione
// sul telefono.
async function autenticazioneFacoltativa(req, res, next) {
    const sessione = await trovaSessione(req);

    if (sessione) {
        req.utente = sessione.utente;
        req.sessioneId = sessione.id;
    }

    next();
}

module.exports = autenticazioneFacoltativa;
