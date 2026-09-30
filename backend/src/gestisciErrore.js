// Error handler finale dell'app (Express lo riconosce dai 4 parametri, per
// questo `next` va dichiarato anche se non sempre usato).
//
// Con Express 5 una Promise rifiutata in una route o in un middleware async
// arriva qui da sola, senza try/catch né wrapper: vale anche per le route
// aggiunte in futuro. Con Express 4 lo stesso errore (es. MySQL non
// raggiungibile) diventava un unhandled rejection che chiudeva il processo.
function gestisciErrore(errore, req, res, next) {
    // Errori del client con uno status già deciso (es. JSON malformato
    // rifiutato da express.json): si risponde con quello.
    if (errore.status >= 400 && errore.status < 500) {
        res.status(errore.status).json({ messaggio: 'Richiesta non valida' });
        return;
    }

    console.error(`${req.method} ${req.originalUrl}`, errore);

    // Risposta già iniziata: si lascia chiudere la connessione a Express.
    if (res.headersSent) {
        next(errore);
        return;
    }

    // Messaggio generico: i dettagli (query, host del DB) restano nei log.
    res.status(500).json({ messaggio: 'Errore interno del server' });
}

module.exports = gestisciErrore;
