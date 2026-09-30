const pool = require('../config/database');
const { deviceIdValido, tokenCorrisponde } = require('./token');

// Sessione valida associata alla richiesta, oppure null (header mancanti,
// token sbagliato, device_id che non combacia, sessione scaduta). Usata sia
// da richiediAutenticazione (null => 401) sia da autenticazioneFacoltativa
// (null => si prosegue da anonimi).
async function trovaSessione(req) {
    const [schema, token] = (req.get('Authorization') || '').split(' ');
    const deviceId = req.get('X-Device-Id');

    if (schema !== 'Bearer' || !token || !deviceIdValido(deviceId)) {
        return null;
    }

    // La riga si cerca per device_id (non segreto); il token si confronta
    // dopo, in Node, a tempo costante.
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
    };
}

module.exports = trovaSessione;
