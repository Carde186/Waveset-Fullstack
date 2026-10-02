// Helper condivisi dai test di integrazione (non è un file di test: il glob
// di `npm test` prende solo *.test.js). I test girano contro il backend in
// esecuzione (docker compose up): chiamate HTTP vere alle API, più una
// connessione diretta a MySQL solo per ciò che dall'esterno non si può né
// forzare né osservare.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
// Guardie dell'ambiente di test (DB e URL): vedi preparaAmbiente.js.
const { verificaUrlAmmesso } = require('./preparaAmbiente');
const mysql = require('mysql2/promise');

// Nessun default verso il backend normale: l'URL è quello del backend di
// test (BACKEND_HOST_PORT di .env.test) oppure, per i file con app locale,
// quello che il file imposta in URL_API_TEST prima di importare questo modulo.
const URL_API =
    process.env.URL_API_TEST ||
    `http://localhost:${process.env.BACKEND_HOST_PORT}/api`;
verificaUrlAmmesso(URL_API);

// Dal Mac il database si raggiunge sulla porta esposta da Docker, non con il
// nome del servizio "mysql" usato dentro la rete di Compose. Host, porta e
// nome del DB li fissa preparaAmbiente.js.
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

// Utenti del seed riservati ai test automatici (04_playlist_seed.sql e
// 09_follow_seed.sql): i test non usano mai Alice, Bob o Admin, che servono
// alle prove a mano (il test di logout-tutti, per esempio, chiuderebbe le
// loro sessioni sul telefono). UTENTE_A segue Nova Circuit (1) e Lucent Wave
// (3), UTENTE_B nessuno. UTENTE_ADMIN ha ruolo ADMIN, per i test degli
// endpoint della coda di revisione Ticketmaster.
const UTENTE_A = { email: 'test-a@waveset.test', password: 'test-a-waveset' };
const UTENTE_B = { email: 'test-b@waveset.test', password: 'test-b-waveset' };
const UTENTE_ADMIN = {
    email: 'test-admin@waveset.test',
    password: 'test-admin-waveset',
};

const deviceUsati = [];

function nuovoDevice() {
    const deviceId = crypto.randomUUID();
    deviceUsati.push(deviceId);
    return deviceId;
}

// Canarina: prova che il server a URL_API legge lo STESSO database su cui il
// test scrive direttamente (db). Si esegue una volta per processo, al primo
// uso HTTP: nei file con app locale il server è già in ascolto, perché la
// prima chiamata HTTP avviene dopo il listen. Se fallisce, fallisce ogni
// chiamata successiva. Il genere di prova si cancella per id e nome esatti,
// mai per prefisso.
let verificaPronta;

function verificaCanarina() {
    verificaPronta ??= eseguiCanarina();
    return verificaPronta;
}

async function eseguiCanarina() {
    const [[{ altri }]] = await db.query(
        "SELECT COUNT(*) AS altri FROM information_schema.schemata WHERE schema_name = 'waveset'",
    );
    assert.equal(altri, 0, "l'istanza MySQL contiene anche il DB 'waveset'");

    const nome = `__canary_${crypto.randomUUID()}`;
    let id;

    try {
        const [inserito] = await db.query(
            'INSERT INTO genere (nome) VALUES (?)',
            [nome],
        );
        id = inserito.insertId;

        const risposta = await fetch(`${URL_API}/generi`);
        const generi = risposta.ok ? await risposta.json() : null;

        assert.ok(
            Array.isArray(generi) &&
                generi.some(g => g.id === id && g.nome === nome),
            `il server a ${URL_API} non legge il database di test: nessuna scrittura HTTP`,
        );
    } finally {
        if (id !== undefined) {
            const [pulito] = await db.query('DELETE FROM genere WHERE id = ? AND nome = ?', [
                id,
                nome,
            ]);
            if (pulito.affectedRows !== 1) throw new Error('CANARINA_PULIZIA_CONTEGGIO_INATTESO');
        }
    }
    return Object.freeze({ verificata: true, pulita: true, righeEliminate: 1 });
}

async function chiama(percorso, { metodo = 'GET', sessione, corpo } = {}) {
    await verificaCanarina();

    const intestazioni = { 'Content-Type': 'application/json' };

    if (sessione) {
        intestazioni.Authorization = `Bearer ${sessione.token}`;
        intestazioni['X-Device-Id'] = sessione.deviceId;
    }

    const risposta = await fetch(`${URL_API}${percorso}`, {
        method: metodo,
        headers: intestazioni,
        body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const testo = await risposta.text();

    return { stato: risposta.status, dati: testo ? JSON.parse(testo) : null };
}

async function accedi(credenziali, deviceId = nuovoDevice()) {
    await verificaCanarina();

    const risposta = await fetch(`${URL_API}/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Device-Id': deviceId,
        },
        body: JSON.stringify(credenziali),
    });

    assert.equal(risposta.status, 200, `login di ${credenziali.email}`);
    const { token, utente } = await risposta.json();

    return { token, deviceId, utente };
}

// Da chiamare in after(): cancella le sessioni create dal file di test e
// chiude la connessione al database.
async function chiudi() {
    if (deviceUsati.length > 0) {
        await db.query('DELETE FROM sessioni WHERE device_id IN (?)', [
            deviceUsati,
        ]);
    }
    await db.end();
}

module.exports = {
    URL_API,
    verificaCanarina,
    db,
    UTENTE_A,
    UTENTE_B,
    UTENTE_ADMIN,
    nuovoDevice,
    chiama,
    accedi,
    chiudi,
};
