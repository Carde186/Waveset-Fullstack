// Crea l'unico ADMIN locale, in modo idempotente: se esiste già un ADMIN non
// modifica nulla. Credenziali da ADMIN_EMAIL / ADMIN_PASSWORD (mai versionate).
const bcrypt = require('bcrypt');

const pool = require('../src/config/database');

const COSTO_BCRYPT = 12;

async function main() {
    if ((process.env.DB_NAME || '').endsWith('_test')) {
        throw new Error("rifiuto di creare l'ADMIN nel DB di test");
    }

    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    const nome = (process.env.ADMIN_NOME || 'Admin').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error('ADMIN_EMAIL mancante o non valida');
    }
    if (password.length < 12) {
        throw new Error('ADMIN_PASSWORD deve avere almeno 12 caratteri');
    }

    const [esistenti] = await pool.query(
        "SELECT id FROM utente WHERE ruolo = 'ADMIN' LIMIT 1",
    );
    if (esistenti.length > 0) {
        console.log("ADMIN già presente: nessuna modifica.");
        return;
    }

    const hash = await bcrypt.hash(password, COSTO_BCRYPT);
    await pool.query(
        "INSERT INTO utente (nome, email, password_hash, ruolo) VALUES (?, ?, ?, 'ADMIN')",
        [nome, email, hash],
    );
    console.log(`ADMIN creato: ${email}`);
}

main()
    .catch(errore => {
        console.error(`creaAdmin: ${errore.message}`);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
