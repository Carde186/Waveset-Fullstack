// Origini ammesse: funzioni pure, nessun DB né rete (il file non importa
// aiuto.js).

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
    MAX_ORIGINI,
    normalizzaOrigine,
    origineAmmessa,
    parseOrigini,
} = require('../src/autenticazione/origini');

describe('normalizzaOrigine: origini valide, forma canonica', () => {
    const VALIDE = [
        ['http://localhost:5173', 'http://localhost:5173'],
        ['HTTP://LOCALHOST:5173', 'http://localhost:5173'],
        ['http://127.0.0.1:5173', 'http://127.0.0.1:5173'],
        ['http://[::1]:5173', 'http://[::1]:5173'],
        ['http://localhost', 'http://localhost'],
        ['http://localhost:80', 'http://localhost'],
        ['https://app.esempio.it', 'https://app.esempio.it'],
        ['https://App.Esempio.IT', 'https://app.esempio.it'],
        ['https://app.esempio.it:443', 'https://app.esempio.it'],
        ['https://app.esempio.it:8443', 'https://app.esempio.it:8443'],
        ['https://a.b.c.esempio.it', 'https://a.b.c.esempio.it'],
        ['https://localhost:5173', 'https://localhost:5173'],
        ['http://localhost:05173', 'http://localhost:5173'],
    ];

    for (const [ingresso, atteso] of VALIDE) {
        test(`${ingresso} -> ${atteso}`, () => {
            assert.equal(normalizzaOrigine(ingresso), atteso);
        });
    }
});

describe('normalizzaOrigine: rifiuta caratteri jolly, null, percorsi e forme parziali', () => {
    const NON_VALIDE = [
        '*',
        'null',
        'NULL',
        '',
        ' ',
        'localhost:5173',
        '//localhost:5173',
        'http://',
        'http://.',
        'http://localhost:5173/',
        'http://localhost:5173/app',
        'http://localhost:5173?x=1',
        'http://localhost:5173#x',
        'http://utente@localhost:5173',
        'http://utente:password@localhost:5173',
        'ftp://localhost',
        'ws://localhost:5173',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'https://*.esempio.it',
        'https://*',
        'https://esempio.*',
        'http://localhost:0',
        'http://localhost:65536',
        'http://localhost:123456',
        'http://localhost:abc',
        'http://localhost:',
        'http://loc alhost',
        'http://localhost:5173 ',
        ' http://localhost:5173',
        'http://localhost:5173\n',
        'https://-esempio.it',
        'https://esempio-.it',
        'https://esempio..it',
        // http è ammesso solo su loopback.
        'http://esempio.it',
        'http://192.168.1.10:5173',
        'http://app.esempio.it:5173',
        // Non ASCII: niente IDN non normalizzati.
        'https://münchen.esempio.it',
    ];

    for (const testo of NON_VALIDE) {
        test(`rifiutata: ${JSON.stringify(testo)}`, () => {
            assert.equal(normalizzaOrigine(testo), null);
        });
    }

    test('valori che non sono testo', () => {
        for (const valore of [undefined, null, 5, true, [], {}, ['http://localhost:5173']]) {
            assert.equal(normalizzaOrigine(valore), null);
        }
    });

    test('testo lunghissimo', () => {
        assert.equal(normalizzaOrigine(`https://${'a'.repeat(400)}.it`), null);
    });
});

describe('parseOrigini', () => {
    test('assente o vuoto: non presente, nessun errore', () => {
        for (const valore of [undefined, null, '', '   ']) {
            const r = parseOrigini(valore);

            assert.equal(r.presente, false);
            assert.equal(r.origini.size, 0);
            assert.deepEqual(r.errori, []);
        }
    });

    test('una origine', () => {
        const r = parseOrigini('http://localhost:5173');

        assert.equal(r.presente, true);
        assert.deepEqual([...r.origini], ['http://localhost:5173']);
        assert.deepEqual(r.errori, []);
    });

    test('più origini con spazi, maiuscole e doppioni', () => {
        const r = parseOrigini(
            ' http://localhost:5173 , HTTPS://App.Esempio.it,http://localhost:5173 ',
        );

        assert.deepEqual([...r.origini], [
            'http://localhost:5173',
            'https://app.esempio.it',
        ]);
        assert.deepEqual(r.errori, []);
    });

    test('una voce non valida invalida TUTTO l\'elenco (mai una configurazione a metà)', () => {
        const r = parseOrigini('http://localhost:5173,*');

        assert.equal(r.origini.size, 0);
        assert.equal(r.errori.length, 1);
        assert.match(r.errori[0], /origine non valida/);
    });

    for (const valore of [
        '*',
        'null',
        'http://localhost:5173/',
        'http://localhost:5173/app',
        'http://localhost:5173,',
        ',http://localhost:5173',
        'http://localhost:5173,,https://app.esempio.it',
    ]) {
        test(`elenco non valido: ${JSON.stringify(valore)}`, () => {
            const r = parseOrigini(valore);

            assert.equal(r.origini.size, 0);
            assert.ok(r.errori.length > 0);
        });
    }

    test('valore che non è un testo', () => {
        for (const valore of [5, true, [], {}]) {
            const r = parseOrigini(valore);

            assert.equal(r.origini.size, 0);
            assert.deepEqual(r.errori, ['il valore non è un testo']);
        }
    });

    test(`al massimo ${MAX_ORIGINI} origini`, () => {
        const dieci = Array.from({ length: MAX_ORIGINI }, (_, i) => `https://a${i}.esempio.it`);

        assert.deepEqual(parseOrigini(dieci.join(',')).errori, []);
        assert.ok(parseOrigini([...dieci, 'https://b.esempio.it'].join(',')).errori.length > 0);
    });

    test('il testo dell\'errore è limitato in lunghezza e non ripete un valore enorme', () => {
        const lungo = `https://${'x'.repeat(5000)}/percorso`;
        const r = parseOrigini(lungo);

        assert.ok(r.errori[0].length < 200);
    });
});

describe('origineAmmessa: confronto ESATTO con l\'intestazione Origin', () => {
    const ORIGINI = new Set(['http://localhost:5173', 'https://app.esempio.it']);

    test('origini configurate: ammesse', () => {
        assert.equal(origineAmmessa('http://localhost:5173', ORIGINI), true);
        assert.equal(origineAmmessa('https://app.esempio.it', ORIGINI), true);
    });

    const RIFIUTATE = [
        undefined,
        null,
        '',
        'null',
        '*',
        // corrispondenze parziali
        'http://localhost:5173.evil.example',
        'http://localhost:5173/',
        'http://localhost:5173/app',
        'http://xlocalhost:5173',
        'http://evil.localhost:5173',
        'http://localhost:51730',
        'http://localhost:517',
        'http://localhost',
        'https://localhost:5173',
        'http://localhost:5173 ',
        ' http://localhost:5173',
        'https://app.esempio.it.evil.example',
        'https://evil.app.esempio.it',
        'https://esempio.it',
        'http://app.esempio.it',
        // il valore ricevuto non si normalizza: niente maiuscole
        'HTTP://LOCALHOST:5173',
        'https://APP.esempio.it',
        // tipi sbagliati
        ['http://localhost:5173'],
        { origin: 'http://localhost:5173' },
        5,
        true,
    ];

    for (const origin of RIFIUTATE) {
        test(`rifiutata: ${JSON.stringify(origin) ?? 'undefined'}`, () => {
            assert.equal(origineAmmessa(origin, ORIGINI), false);
        });
    }

    test('senza origini configurate nulla è ammesso', () => {
        assert.equal(origineAmmessa('http://localhost:5173', new Set()), false);
    });

    test('un elenco che non è un Set non ammette nulla', () => {
        for (const origini of [undefined, null, ['http://localhost:5173'], 'http://localhost:5173']) {
            assert.equal(origineAmmessa('http://localhost:5173', origini), false);
        }
    });
});
