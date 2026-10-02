// Rate limit della registrazione: 429, Retry-After, reset della finestra e
// prova che le richieste bloccate NON arrivano a bcrypt. App eseguita nel
// processo del test (porta dedicata) per poter iniettare soglie basse, un
// orologio controllato e uno spy su bcrypt.hash. Database: solo waveset_test
// (guardie e canarina di aiuto.js).
process.env.DB_HOST = '127.0.0.1';
process.env.URL_API_TEST = 'http://127.0.0.1:3095/api';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, describe, mock, test } = require('node:test');

const bcrypt = require('bcrypt');

const { URL_API, db, chiudi, verificaCanarina } = require('./aiuto');

const creaApp = require('../src/app');
const poolApp = require('../src/config/database');
const {
    MESSAGGIO_429,
    creaLimitatore,
} = require('../src/autenticazione/limiteRichieste');

const MASSIMO = 3;
const FINESTRA_MS = 900_000;
const PASSWORD = 'password-di-prova-12';

// Orologio del limitatore: si muove solo quando lo dice il test.
let adesso = 1_000_000;
const ora = () => adesso;

let server;
let spiaHash;
let utentiPrima;
const emailUsate = new Set();

function corpoValido() {
    const email = `lim-${crypto.randomUUID()}@esempio.test`;
    emailUsate.add(email);

    return { nome: 'Utente Limite', email, password: PASSWORD };
}

async function invia(corpo, intestazioni = {}) {
    const risposta = await fetch(`${URL_API}/auth/registrazione`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...intestazioni },
        body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    });
    const testo = await risposta.text();

    return {
        stato: risposta.status,
        retryAfter: risposta.headers.get('retry-after'),
        dati: testo ? JSON.parse(testo) : null,
    };
}

async function contaPerEmail(email) {
    const [[{ n }]] = await db.query(
        'SELECT COUNT(*) AS n FROM utente WHERE email = ?',
        [email],
    );
    return n;
}

const chiamateBcrypt = () => spiaHash.mock.calls.length;

before(async () => {
    // Registra le chiamate a bcrypt.hash lasciando l'implementazione originale.
    spiaHash = mock.method(bcrypt, 'hash');

    const limitatore = creaLimitatore({
        massimo: MASSIMO,
        finestraMs: FINESTRA_MS,
        ora,
    });

    await new Promise((risolvi, rifiuta) => {
        server = creaApp({ limitatoreRegistrazione: limitatore }).listen(
            3095,
            errore => (errore ? rifiuta(errore) : risolvi()),
        );
    });
    await verificaCanarina();

    [[{ n: utentiPrima }]] = await db.query('SELECT COUNT(*) AS n FROM utente');
});

after(async () => {
    try {
        if (emailUsate.size > 0) {
            await db.query('DELETE FROM utente WHERE email IN (?)', [
                [...emailUsate],
            ]);
        }

        const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM utente');
        assert.equal(n, utentiPrima, 'righe residue in utente dopo la pulizia');
    } finally {
        spiaHash.mock.restore();
        await chiudi();
        await poolApp.end();
        await new Promise(risolvi => server.close(risolvi));
    }
});

// I test di questo blocco sono in sequenza e condividono la finestra del
// limitatore e l'orologio.
describe('registrazione con rate limit (3 richieste per IP in 900 s)', () => {
    test('le prime 3 richieste valide passano (201) e ognuna arriva a bcrypt', async () => {
        for (let i = 0; i < MASSIMO; i++) {
            const { stato } = await invia(corpoValido());

            assert.equal(stato, 201);
        }

        assert.equal(chiamateBcrypt(), MASSIMO);
    });

    test('la quarta richiesta valida: 429, Retry-After, corpo generico, nessuna riga, bcrypt non chiamato', async () => {
        const corpo = corpoValido();
        const { stato, retryAfter, dati } = await invia(corpo);

        assert.equal(stato, 429);
        assert.equal(retryAfter, '900');
        assert.deepEqual(dati, { messaggio: MESSAGGIO_429 });
        assert.equal(await contaPerEmail(corpo.email), 0);
        assert.equal(chiamateBcrypt(), MASSIMO);
    });

    test('bloccata anche con JSON malformato o corpo non valido: 429 e non 400 (il limite precede express.json e la validazione)', async () => {
        for (const corpo of ['{"nome": ', {}, { ruolo: 'ADMIN' }]) {
            const { stato, retryAfter } = await invia(corpo);

            assert.equal(stato, 429);
            assert.equal(retryAfter, '900');
        }

        assert.equal(chiamateBcrypt(), MASSIMO);
    });

    test('X-Forwarded-For non aggira il limite: con trust proxy disattivato conta l\'IP del socket', async () => {
        const corpo = corpoValido();
        const { stato } = await invia(corpo, {
            'X-Forwarded-For': '203.0.113.77',
        });

        assert.equal(stato, 429);
        assert.equal(await contaPerEmail(corpo.email), 0);
        assert.equal(chiamateBcrypt(), MASSIMO);
    });

    test('le altre route non sono bloccate: catalogo e login (400 per corpo mancante, non 429)', async () => {
        const generi = await fetch(`${URL_API}/generi`);
        assert.equal(generi.status, 200);

        const login = await fetch(`${URL_API}/auth/login`, { method: 'POST' });
        assert.equal(login.status, 400);
    });

    test('Retry-After scende con il tempo e la finestra si azzera alla scadenza', async () => {
        adesso += 899_000;
        const quasiScaduta = await invia(corpoValido());
        assert.equal(quasiScaduta.stato, 429);
        assert.equal(quasiScaduta.retryAfter, '1');

        adesso += 1_000; // la finestra è scaduta
        const dopoReset = await invia(corpoValido());
        assert.equal(dopoReset.stato, 201);
        assert.equal(chiamateBcrypt(), MASSIMO + 1);
    });

    test('dopo il reset il conteggio riparte: altre 2 passano, la quarta della nuova finestra è bloccata', async () => {
        // La richiesta del test precedente era la prima della nuova finestra.
        assert.equal((await invia(corpoValido())).stato, 201);
        assert.equal((await invia(corpoValido())).stato, 201);

        const bloccata = await invia(corpoValido());
        assert.equal(bloccata.stato, 429);
        assert.equal(bloccata.retryAfter, '900');
        assert.equal(chiamateBcrypt(), MASSIMO + 3);
    });

    test('anche i fallimenti contano: 3 richieste non valide (400) esauriscono la finestra e la successiva valida è bloccata', async () => {
        adesso += FINESTRA_MS;
        const bcryptPrima = chiamateBcrypt();

        for (let i = 0; i < MASSIMO; i++) {
            const { stato, dati } = await invia({ nome: 'solo il nome' });

            assert.equal(stato, 400);
            assert.equal(dati.messaggio, 'Dati non validi');
        }

        const valida = corpoValido();
        const { stato } = await invia(valida);

        assert.equal(stato, 429);
        assert.equal(await contaPerEmail(valida.email), 0);
        // Le non valide non arrivano a bcrypt (falliscono prima), la bloccata neanche.
        assert.equal(chiamateBcrypt(), bcryptPrima);
    });
});
