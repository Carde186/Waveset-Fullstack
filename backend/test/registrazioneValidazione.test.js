// Validazione della registrazione: funzione pura, nessun DB né rete (per questo
// il file non importa aiuto.js). Le prove su DB e HTTP sono in
// registrazione.test.js.

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { validaRegistrazione } = require('../src/autenticazione/registrazione');

const VALIDO = {
    nome: 'Utente Prova',
    email: 'utente@esempio.test',
    password: 'password-di-prova-12',
};

function esito(sovrascritture) {
    return validaRegistrazione({ ...VALIDO, ...sovrascritture });
}

function campiInvalidi(risultato) {
    assert.equal(risultato.ok, false);
    return Object.keys(risultato.campi).sort();
}

describe('corpo valido', () => {
    test('normalizza nome ed email, non tocca la password', () => {
        const r = validaRegistrazione({
            nome: '  Nome Prova  ',
            email: '  Mix.Case@Esempio.TEST  ',
            password: '  spazi-ai-bordi-12  ',
        });

        assert.equal(r.ok, true);
        assert.deepEqual(r.dati, {
            nome: 'Nome Prova',
            email: 'mix.case@esempio.test',
            password: '  spazi-ai-bordi-12  ',
        });
    });
});

describe('forma del corpo', () => {
    for (const corpo of [undefined, null, 'testo', 42, true, [], [VALIDO]]) {
        test(`non è un oggetto: ${JSON.stringify(corpo) ?? 'undefined'}`, () => {
            assert.deepEqual(campiInvalidi(validaRegistrazione(corpo)), [
                'corpo',
            ]);
        });
    }

    test('oggetto vuoto: mancano tutti e tre i campi', () => {
        assert.deepEqual(campiInvalidi(validaRegistrazione({})), [
            'email',
            'nome',
            'password',
        ]);
    });
});

describe('campi non ammessi: allowlist esatta nome, email, password', () => {
    const NON_AMMESSI = {
        ruolo: 'ADMIN',
        role: 'ADMIN',
        Ruolo: 'ADMIN',
        ROLE: 'ADMIN',
        ruolo_utente: 'USER',
        id: 1,
        admin: true,
        extra: 'x',
    };

    for (const [chiave, valore] of Object.entries(NON_AMMESSI)) {
        test(`"${chiave}" dà 400`, () => {
            assert.deepEqual(campiInvalidi(esito({ [chiave]: valore })), [
                'corpo',
            ]);
        });
    }

    test('anche ruolo "USER" è rifiutato: conta la presenza, non il valore', () => {
        assert.deepEqual(campiInvalidi(esito({ ruolo: 'USER' })), ['corpo']);
    });

    test('"__proto__" come chiave del JSON è rifiutata', () => {
        const corpo = JSON.parse(
            '{"nome":"A","email":"a@esempio.test","password":"password-di-prova-12","__proto__":{"ruolo":"ADMIN"}}',
        );

        assert.deepEqual(campiInvalidi(validaRegistrazione(corpo)), ['corpo']);
    });

    test('la risposta non riporta i nomi dei campi inviati', () => {
        const r = esito({ campo_molto_particolare: 1 });

        assert.ok(!JSON.stringify(r).includes('campo_molto_particolare'));
    });
});

describe('nome', () => {
    for (const nome of [undefined, null, 5, [], {}, '', '   ', 'a\u0000b', 'a\nb']) {
        test(`rifiutato: ${JSON.stringify(nome) ?? 'undefined'}`, () => {
            assert.deepEqual(campiInvalidi(esito({ nome })), ['nome']);
        });
    }

    test('200 caratteri accettati, 201 rifiutati', () => {
        assert.equal(esito({ nome: 'a'.repeat(200) }).ok, true);
        assert.deepEqual(campiInvalidi(esito({ nome: 'a'.repeat(201) })), [
            'nome',
        ]);
    });

    test('i caratteri sono punti di codice, non unità UTF-16', () => {
        assert.equal(esito({ nome: '😀'.repeat(200) }).ok, true);
        assert.equal(esito({ nome: '😀'.repeat(201) }).ok, false);
    });
});

describe('email', () => {
    const NON_VALIDE = [
        undefined,
        null,
        5,
        [],
        '',
        '   ',
        'senza-chiocciola.test',
        'due@@esempio.test',
        'a b@esempio.test',
        'a@esempio',
        '@esempio.test',
        'a@.test',
    ];

    for (const email of NON_VALIDE) {
        test(`rifiutata: ${JSON.stringify(email) ?? 'undefined'}`, () => {
            assert.deepEqual(campiInvalidi(esito({ email })), ['email']);
        });
    }

    test('spazi e a capo ai bordi vengono tolti prima del controllo', () => {
        assert.equal(esito({ email: ' a@esempio.test\n' }).dati.email, 'a@esempio.test');
    });

    test('oltre 255 caratteri rifiutata, esattamente 255 accettata', () => {
        const lungaOk = `${'a'.repeat(255 - '@esempio.test'.length)}@esempio.test`;

        assert.equal(lungaOk.length, 255);
        assert.equal(esito({ email: lungaOk }).ok, true);
        assert.deepEqual(campiInvalidi(esito({ email: `a${lungaOk}` })), [
            'email',
        ]);
    });

    test('con caratteri di controllo rifiutata', () => {
        assert.deepEqual(campiInvalidi(esito({ email: 'a\u0000@esempio.test' })), [
            'email',
        ]);
    });

    describe('dominio riservato waveset.test e sottodomini', () => {
        for (const email of [
            'x@waveset.test',
            'X@WAVESET.TEST',
            '  x@Waveset.Test  ',
            'x@sub.waveset.test',
            'x@a.b.waveset.test',
        ]) {
            test(`rifiutata: ${email.trim()}`, () => {
                const r = esito({ email });

                assert.deepEqual(campiInvalidi(r), ['email']);
                assert.equal(r.campi.email, 'dominio riservato');
            });
        }

        for (const email of [
            'x@evilwaveset.test',
            'x@waveset.test.esempio.it',
            'x@waveset.testing',
            'waveset.test@esempio.it',
        ]) {
            test(`non riservata: ${email}`, () => {
                assert.equal(esito({ email }).ok, true);
            });
        }
    });
});

describe('password: minimo 12 caratteri, massimo 72 byte UTF-8', () => {
    test('11 caratteri rifiutata, 12 accettata', () => {
        assert.deepEqual(campiInvalidi(esito({ password: 'a'.repeat(11) })), [
            'password',
        ]);
        assert.equal(esito({ password: 'a'.repeat(12) }).ok, true);
    });

    test('72 byte accettati, 73 rifiutati', () => {
        assert.equal(esito({ password: 'a'.repeat(72) }).ok, true);
        assert.deepEqual(campiInvalidi(esito({ password: 'a'.repeat(73) })), [
            'password',
        ]);
    });

    test('25 caratteri da 3 byte (75 byte) rifiutati: conta il byte, non il carattere', () => {
        const password = '€'.repeat(25);

        assert.equal(Buffer.byteLength(password, 'utf8'), 75);
        assert.deepEqual(campiInvalidi(esito({ password })), ['password']);
    });

    test('24 caratteri da 3 byte (72 byte) accettati', () => {
        assert.equal(esito({ password: '€'.repeat(24) }).ok, true);
    });

    test('12 emoji (48 byte) accettate: 12 punti di codice, non 24 unità UTF-16', () => {
        assert.equal(esito({ password: '😀'.repeat(12) }).ok, true);
        assert.deepEqual(campiInvalidi(esito({ password: '😀'.repeat(11) })), [
            'password',
        ]);
    });

    for (const password of [undefined, null, 12345678901234, [], {}, '', ' '.repeat(20), 'ab\u0000cdefghijkl']) {
        test(`rifiutata: ${JSON.stringify(password) ?? 'undefined'}`, () => {
            assert.deepEqual(campiInvalidi(esito({ password })), ['password']);
        });
    }

    test('non viene trimmata: 12 caratteri di cui gli spazi ai bordi contano', () => {
        assert.equal(esito({ password: '  abcdefgh  ' }).ok, true);
        assert.equal(
            esito({ password: '  abcdefgh  ' }).dati.password,
            '  abcdefgh  ',
        );
    });

    test("il motivo dell'errore non contiene la password rifiutata", () => {
        const r = esito({ password: 'segreta' });

        assert.equal(r.ok, false);
        assert.ok(!JSON.stringify(r).includes('segreta'));
    });
});

describe('errori multipli', () => {
    test('si riportano tutti i campi non validi insieme', () => {
        const r = validaRegistrazione({ nome: '', email: 'x', password: 'a', ruolo: 'ADMIN' });

        assert.deepEqual(campiInvalidi(r), ['corpo', 'email', 'nome', 'password']);
    });
});
