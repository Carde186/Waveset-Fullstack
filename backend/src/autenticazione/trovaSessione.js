const pool = require('../config/database');
const { leggiCookieSessione } = require('./cookieSessione');
const { deviceIdValido, tokenCorrisponde } = require('./token');

// Controllo lato server, IDENTICO per i due trasporti: riga cercata per
// device_id (non segreto), token confrontato dopo in Node a tempo costante,
// scadenza controllata solo dopo aver verificato il token.
async function sessionePerCredenziali(deviceId, token, via) {
    const [righe] = await pool.query(
        `SELECT s.id, s.utente_id, s.hash_token, s.scadenza > NOW() AS valida,
                u.ruolo
         FROM sessioni s
         INNER JOIN utente u ON u.id = s.utente_id
         WHERE s.device_id = ?`,
        [deviceId],
    );

    const sessione = righe[0];

    if (!sessione || !tokenCorrisponde(token, sessione.hash_token)) {
        return null;
    }

    // La scadenza si controlla solo dopo aver verificato il token: così
    // chi non ha il token non può far cancellare la sessione altrui.
    if (!sessione.valida) {
        await pool.query('DELETE FROM sessioni WHERE id = ?', [sessione.id]);
        return null;
    }

    return {
        id: sessione.id,
        utente: { id: sessione.utente_id, ruolo: sessione.ruolo },
        via,
    };
}

// Sessione valida associata alla richiesta, oppure null (header mancanti,
// token sbagliato, device_id che non combacia, sessione scaduta). Usata sia
// da richiediAutenticazione (null => 401) sia da autenticazioneFacoltativa
// (null => si prosegue da anonimi). Il risultato porta `via`: 'bearer' o
// 'cookie'.
//
// Due trasporti, mai mescolati:
// - Authorization PRESENTE (anche vuota, anche non Bearer): conta solo il
//   bearer, valido o no. Non c'è MAI un ripiego sul cookie: un client che
//   manda Authorization sta usando il bearer (l'app Android) e resta com'è.
// - Authorization ASSENTE: si guarda il cookie della sessione browser, ma solo
//   se la sessione web è configurata (FRONTEND_ORIGINS valida). Senza
//   configurazione valida il cookie non autentica nessuno.
async function trovaSessione(req) {
    const autorizzazione = req.get('Authorization');

    if (autorizzazione !== undefined) {
        const [schema, token] = autorizzazione.split(' ');
        const deviceId = req.get('X-Device-Id');

        if (schema !== 'Bearer' || !token || !deviceIdValido(deviceId)) {
            return null;
        }

        return sessionePerCredenziali(deviceId, token, 'bearer');
    }

    const web = req.app?.locals?.configurazioneWeb;

    if (!web?.abilitata) {
        return null;
    }

    const cookie = leggiCookieSessione(req.get('Cookie'));

    if (cookie.stato !== 'valido') {
        return null;
    }

    return sessionePerCredenziali(cookie.deviceId, cookie.token, 'cookie');
}

module.exports = trovaSessione;
