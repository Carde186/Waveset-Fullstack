// POST /api/auth/registrazione contro il backend dell'ambiente di TEST
// (waveset_test): guardie e canarina di aiuto.js valgono anche qui. Ogni utente
// creato si cancella per email esatta (cascata su sessioni) e a fine file la
// tabella utente deve tornare com'era.
//
// Il dominio "esempio.test" è quello dei dati di prova; "waveset.test" è
// riservato e non si può registrare.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, describe, test } = require('node:test');

const bcrypt = require('bcrypt');

const {
    URL_API,
    db,
    chiama,
    accedi,
    chiudi,
    verificaCanarina,
} = require('./aiuto');

const PASSWORD = 'password-di-prova-12';
const emailUsate = new Set();

let utentiPrima;
let adminPrima;

function nuovaEmail() {
    const email = `reg-${crypto.randomUUID()}@esempio.test`;
    emailUsate.add(email);
    return email;
}

function registra(corpo) {
    return chiama('/auth/registrazione', { metodo: 'POST', corpo });
}

async function utentePerEmail(email) {
    const [righe] = await db.query(
        'SELECT id, nome, email, password_hash, ruolo FROM utente WHERE email = ?',
        [email],
    );
    return righe[0] ?? null;
}

async function contaPerEmail(email) {
    const [[{ n }]] = await db.query(
        'SELECT COUNT(*) AS n FROM utente WHERE email = ?',
        [email],
    );
    return n;
}

before(async () => {
    await verificaCanarina();

    [[{ n: utentiPrima }]] = await db.query('SELECT COUNT(*) AS n FROM utente');
    [[{ n: adminPrima }]] = await db.query(
        "SELECT COUNT(*) AS n FROM utente WHERE ruolo = 'ADMIN'",
    );
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
        await chiudi();
    }
});

describe('registrazione riuscita', () => {
    test('201, ruolo USER deciso dal server, hash bcrypt, nessuna sessione', async () => {
        const email = nuovaEmail();
        const { stato, dati } = await registra({
            nome: 'Utente Prova',
            email,
            password: PASSWORD,
        });

        assert.equal(stato, 201);
        assert.deepEqual(Object.keys(dati), ['utente']);
        assert.deepEqual(Object.keys(dati.utente).sort(), [
            'email',
            'id',
            'nome',
            'ruolo',
        ]);
        assert.equal(dati.utente.ruolo, 'USER');
        assert.equal(dati.utente.email, email);
        assert.equal(typeof dati.utente.id, 'number');

        const riga = await utentePerEmail(email);
        assert.equal(riga.id, dati.utente.id);
        assert.equal(riga.ruolo, 'USER');
        assert.match(riga.password_hash, /^\$2b\$12\$/);
        assert.equal(riga.password_hash.length, 60);
        assert.notEqual(riga.password_hash, PASSWORD);
        assert.equal(await bcrypt.compare(PASSWORD, riga.password_hash), true);

        // Niente password, hash o token nella risposta.
        const testo = JSON.stringify(dati);
        assert.ok(!testo.includes(PASSWORD));
        assert.ok(!testo.includes(riga.password_hash));
        assert.ok(!('token' in dati));

        const [[{ n }]] = await db.query(
            'SELECT COUNT(*) AS n FROM sessioni WHERE utente_id = ?',
            [riga.id],
        );
        assert.equal(n, 0);
    });

    test('il nuovo utente entra con il login bearer già esistente', async () => {
        const email = nuovaEmail();
        await registra({ nome: 'Utente Login', email, password: PASSWORD });

        const sessione = await accedi({ email, password: PASSWORD });

        assert.equal(sessione.utente.email, email);
        assert.equal(sessione.utente.ruolo, 'USER');
        assert.match(sessione.token, /^[0-9a-f]{64}$/);
    });

    test('nome ed email vengono normalizzati; il login non distingue le maiuscole', async () => {
        const normalizzata = `reg-${crypto.randomUUID()}@esempio.test`;
        emailUsate.add(normalizzata);

        const { stato, dati } = await registra({
            nome: '  Nome Prova  ',
            email: `  ${normalizzata.toUpperCase()}  `,
            password: PASSWORD,
        });

        assert.equal(stato, 201);
        assert.equal(dati.utente.email, normalizzata);
        assert.equal(dati.utente.nome, 'Nome Prova');
        assert.equal((await utentePerEmail(normalizzata)).nome, 'Nome Prova');

        const sessione = await accedi({
            email: normalizzata.toUpperCase(),
            password: PASSWORD,
        });
        assert.equal(sessione.utente.email, normalizzata);
    });
});

describe('email duplicata: 409', () => {
    test('stessa email, variante maiuscola e password diversa: 409, hash originale invariato', async () => {
        const email = nuovaEmail();
        const primo = await registra({
            nome: 'Primo',
            email,
            password: PASSWORD,
        });
        assert.equal(primo.stato, 201);
        const prima = await utentePerEmail(email);

        for (const corpo of [
            { nome: 'Secondo', email, password: PASSWORD },
            { nome: 'Secondo', email: email.toUpperCase(), password: PASSWORD },
            { nome: 'Secondo', email, password: 'un-altra-password-12' },
        ]) {
            const { stato, dati } = await registra(corpo);

            assert.equal(stato, 409);
            assert.deepEqual(dati, { messaggio: 'Email già registrata' });
        }

        assert.equal(await contaPerEmail(email), 1);
        const dopo = await utentePerEmail(email);
        assert.equal(dopo.id, prima.id);
        assert.equal(dopo.nome, 'Primo');
        assert.equal(dopo.password_hash, prima.password_hash);
    });

    test('due richieste parallele con la stessa email: un solo 201 e un solo 409', async () => {
        const email = nuovaEmail();
        const corpo = { nome: 'Parallelo', email, password: PASSWORD };

        const esiti = await Promise.all([registra(corpo), registra(corpo)]);

        assert.deepEqual(esiti.map(e => e.stato).sort(), [201, 409]);
        assert.equal(await contaPerEmail(email), 1);
    });

    test('un utente di test già esistente non si può ri-registrare né alterare', async () => {
        const [[prima]] = await db.query(
            "SELECT id, password_hash, ruolo FROM utente WHERE email = 'test-a@waveset.test'",
        );

        const { stato, dati } = await registra({
            nome: 'Impostore',
            email: 'test-a@waveset.test',
            password: PASSWORD,
        });

        assert.equal(stato, 400);
        assert.equal(dati.campi.email, 'dominio riservato');

        const [[dopo]] = await db.query(
            "SELECT id, password_hash, ruolo FROM utente WHERE email = 'test-a@waveset.test'",
        );
        assert.deepEqual(dopo, prima);
    });
});

describe('ruolo e altri campi non ammessi: 400, nessuna riga', () => {
    const CASI = [
        ['ruolo ADMIN', { ruolo: 'ADMIN' }],
        ['ruolo USER', { ruolo: 'USER' }],
        ['role ADMIN', { role: 'ADMIN' }],
        ['Ruolo con altra grafia', { Ruolo: 'ADMIN' }],
        ['id', { id: 1 }],
        ['campo qualsiasi', { extra: 'x' }],
    ];

    for (const [nome, extra] of CASI) {
        test(nome, async () => {
            const email = nuovaEmail();
            const { stato, dati } = await registra({
                nome: 'Prova',
                email,
                password: PASSWORD,
                ...extra,
            });

            assert.equal(stato, 400);
            assert.equal(dati.messaggio, 'Dati non validi');
            assert.deepEqual(Object.keys(dati.campi), ['corpo']);
            assert.equal(await contaPerEmail(email), 0);
        });
    }
});

describe('domini riservati ai test: 400, nessuna riga', () => {
    for (const email of [
        'nuovo@waveset.test',
        'NUOVO@WAVESET.TEST',
        'nuovo@sub.waveset.test',
    ]) {
        test(email, async () => {
            emailUsate.add(email.trim().toLowerCase());

            const { stato, dati } = await registra({
                nome: 'Prova',
                email,
                password: PASSWORD,
            });

            assert.equal(stato, 400);
            assert.equal(dati.campi.email, 'dominio riservato');
            assert.equal(await contaPerEmail(email), 0);
        });
    }
});

describe('validazione dei campi: 400, nessuna riga', () => {
    const CASI = [
        ['password mancante', { password: undefined }, 'password'],
        ['password di 11 caratteri', { password: 'a'.repeat(11) }, 'password'],
        ['password di 73 byte', { password: 'a'.repeat(73) }, 'password'],
        ['email non valida', { email: 'non-una-email' }, 'email'],
        ['nome vuoto', { nome: '   ' }, 'nome'],
    ];

    for (const [nome, sovrascrittura, campo] of CASI) {
        test(nome, async () => {
            const email = nuovaEmail();
            const { stato, dati } = await registra({
                nome: 'Prova',
                email,
                password: PASSWORD,
                ...sovrascrittura,
            });

            assert.equal(stato, 400);
            assert.equal(dati.messaggio, 'Dati non validi');
            assert.ok(campo in dati.campi);
            assert.ok(!JSON.stringify(dati).includes(PASSWORD));
            assert.equal(await contaPerEmail(email), 0);
        });
    }
});

describe('corpo della richiesta', () => {
    const INDIRIZZO = `${URL_API}/auth/registrazione`;

    async function invia(intestazioni, corpo) {
        const risposta = await fetch(INDIRIZZO, {
            method: 'POST',
            headers: intestazioni,
            body: corpo,
        });
        const testo = await risposta.text();

        return { stato: risposta.status, dati: testo ? JSON.parse(testo) : null };
    }

    test('JSON malformato: 400 generico, non 500', async () => {
        const { stato, dati } = await invia(
            { 'Content-Type': 'application/json' },
            '{"nome": ',
        );

        assert.equal(stato, 400);
        assert.deepEqual(dati, { messaggio: 'Richiesta non valida' });
    });

    test('corpo assente: 400', async () => {
        const { stato, dati } = await invia({}, undefined);

        assert.equal(stato, 400);
        assert.equal(dati.messaggio, 'Dati non validi');
    });

    test('tipo di contenuto diverso da JSON: 400 e nessuna riga', async () => {
        const email = nuovaEmail();
        const { stato } = await invia(
            { 'Content-Type': 'text/plain' },
            JSON.stringify({ nome: 'Prova', email, password: PASSWORD }),
        );

        assert.equal(stato, 400);
        assert.equal(await contaPerEmail(email), 0);
    });

    test('JSON valido ma array: 400', async () => {
        const { stato, dati } = await invia(
            { 'Content-Type': 'application/json' },
            JSON.stringify([{ nome: 'A', email: nuovaEmail(), password: PASSWORD }]),
        );

        assert.equal(stato, 400);
        assert.deepEqual(Object.keys(dati.campi), ['corpo']);
    });
});

describe('invarianti finali', () => {
    test('nessun ADMIN è stato creato dalla registrazione', async () => {
        const [[{ n }]] = await db.query(
            "SELECT COUNT(*) AS n FROM utente WHERE ruolo = 'ADMIN'",
        );

        assert.equal(n, adminPrima);
    });
});
