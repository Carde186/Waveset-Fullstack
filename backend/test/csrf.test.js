// Token CSRF legato al token di sessione: funzioni pure, nessun DB né rete (il
// file non importa aiuto.js).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, test } = require('node:test');

const { csrfValido, generaCsrf } = require('../src/autenticazione/csrf');

const TOKEN = crypto.randomBytes(32).toString('hex');
const ALTRO_TOKEN = crypto.randomBytes(32).toString('hex');

describe('generaCsrf', () => {
    test('64 caratteri esadecimali minuscoli', () => {
        assert.match(generaCsrf(TOKEN), /^[0-9a-f]{64}$/);
    });

    test('deterministico per lo stesso token di sessione', () => {
        assert.equal(generaCsrf(TOKEN), generaCsrf(TOKEN));
    });

    test('diverso per sessioni diverse', () => {
        assert.notEqual(generaCsrf(TOKEN), generaCsrf(ALTRO_TOKEN));
    });

    test('non coincide con il token di sessione e non lo contiene', () => {
        const csrf = generaCsrf(TOKEN);

        assert.notEqual(csrf, TOKEN);
        assert.ok(!csrf.includes(TOKEN.slice(0, 16)));
    });

    test('valore di riferimento fisso (HMAC-SHA256 con il token come chiave)', () => {
        const atteso = crypto
            .createHmac('sha256', 'a'.repeat(64))
            .update('waveset:csrf:v1')
            .digest('hex');

        assert.equal(generaCsrf('a'.repeat(64)), atteso);
    });

    for (const token of [undefined, null, '', 'corto', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(63)}\n`, 5, [], {}]) {
        test(`token di sessione non valido: ${JSON.stringify(token) ?? 'undefined'}`, () => {
            assert.throws(() => generaCsrf(token), TypeError);
        });
    }
});

describe('csrfValido', () => {
    const VALIDO = generaCsrf(TOKEN);

    test('il token giusto è valido', () => {
        assert.equal(csrfValido(TOKEN, VALIDO), true);
    });

    test('un token errato della stessa lunghezza non è valido', () => {
        const sbagliato = `${VALIDO.slice(0, 63)}${VALIDO.endsWith('0') ? '1' : '0'}`;

        assert.equal(sbagliato.length, VALIDO.length);
        assert.equal(csrfValido(TOKEN, sbagliato), false);
        assert.equal(csrfValido(TOKEN, `${VALIDO[0] === '0' ? '1' : '0'}${VALIDO.slice(1)}`), false);
    });

    test('il token CSRF di un\'altra sessione non è valido', () => {
        assert.equal(csrfValido(TOKEN, generaCsrf(ALTRO_TOKEN)), false);
        assert.equal(csrfValido(ALTRO_TOKEN, VALIDO), false);
    });

    test('il token di sessione stesso non vale come CSRF', () => {
        assert.equal(csrfValido(TOKEN, TOKEN), false);
    });

    test('lunghezze diverse: falso e nessuna eccezione (nessuna RangeError di timingSafeEqual)', () => {
        for (const presentato of [
            '',
            'a',
            VALIDO.slice(0, 63),
            VALIDO.slice(0, 32),
            `${VALIDO}0`,
            `${VALIDO}${VALIDO}`,
            'a'.repeat(10_000),
            'a'.repeat(1_000_000),
        ]) {
            assert.equal(csrfValido(TOKEN, presentato), false);
        }
    });

    test('spazi, a capo e maiuscole attorno al valore giusto non valgono', () => {
        assert.equal(csrfValido(TOKEN, ` ${VALIDO}`), false);
        assert.equal(csrfValido(TOKEN, `${VALIDO} `), false);
        assert.equal(csrfValido(TOKEN, `${VALIDO}\n`), false);
        assert.equal(csrfValido(TOKEN, VALIDO.toUpperCase()), false);
    });

    test('valori che non sono un testo: falso, nessuna eccezione', () => {
        for (const presentato of [undefined, null, 0, 123, true, [], [VALIDO], {}, { csrf: VALIDO }, Buffer.from(VALIDO)]) {
            assert.equal(csrfValido(TOKEN, presentato), false);
        }
    });

    test('token di sessione non valido: falso, nessuna eccezione', () => {
        for (const token of [undefined, null, '', 'corto', 'A'.repeat(64), 5, []]) {
            assert.equal(csrfValido(token, VALIDO), false);
        }
    });

    test('non dipende da altro che dal token di sessione: stesso risultato a ogni chiamata', () => {
        for (let i = 0; i < 20; i++) {
            assert.equal(csrfValido(TOKEN, VALIDO), true);
            assert.equal(csrfValido(TOKEN, 'x'), false);
        }
    });
});
