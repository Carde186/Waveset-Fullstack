const express = require('express');

const pool = require('../config/database');

const router = express.Router();

async function controllaSalute(req, res) {
    try {
        await pool.query('SELECT 1');
        res.json({ stato: 'ok', database: 'connesso' });
    } catch (errore) {
        res.status(503).json({
            stato: 'errore',
            database: 'non raggiungibile',
            messaggio: errore.message,
        });
    }
}

router.get('/health', controllaSalute);

module.exports = router;
