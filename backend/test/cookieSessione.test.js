// Cookie della sessione browser: funzioni pure, nessun DB né rete (il file non
// importa aiuto.js).

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
    DURATA_SESSIONE_WEB_SEC,
    NOME_COOKIE,
    PERCORSO_COOKIE,
    cancellaCookieSessione,
    cookieSicuro,
    leggiCookieSessione,
    serializzaCookieSessione,
} = require('../src/autenticazione/cookieSessione');

const DEVICE = '3f2b8c1e-9a4d-4f6b-8c2a-1d5e7f9a0b3c';
const TOKEN = 'a'.repeat(64);
const COOKIE = `${NOME_COOKIE}=${DEVICE}.${TOKEN}`;

// Attributi di una stringa Set-Cookie: { nome, valore, attributi: Map }.
function analizza(setCookie) {
    const [coppia, ...resto] = setCookie.split('; ');
    const attributi = new Map();

    for (const a of resto) {
        const uguale = a.indexOf('=');

        attributi.set(
            (uguale === -1 ? a : a.slice(0, uguale)).toLowerCase(),
            uguale === -1 ? true : a.slice(uguale + 1),
        );
    }

    return { coppia, attributi };
}

describe('costanti', () => {
    test('nome, percorso e durata della sessione web (7 giorni)', () => {
        assert.equal(NOME_COOKIE, 'waveset_sid');
        assert.equal(PERCORSO_COOKIE, '/api');
        assert.equal(DURATA_SESSIONE_WEB_SEC, 604800);
    });
});

describe('leggiCookieSessione: cookie assente', () => {
    for (const intestazione of [
        undefined,
        null,
        '',
        'altro=1',
        'a=1; b=2',
        ';;',
        'waveset_sid2=x',
        'xwaveset_sid=x',
        // i nomi dei cookie distinguono le maiuscole
        `WAVESET_SID=${DEVICE}.${TOKEN}`,
        `Waveset_Sid=${DEVICE}.${TOKEN}`,
    ]) {
        test(`assente: ${JSON.stringify(intestazione) ?? 'undefined'}`, () => {
            assert.deepEqual(leggiCookieSessione(intestazione), {
                stato: 'assente',
            });
        });
    }
});

describe('leggiCookieSessione: cookie valido', () => {
    test('da solo', () => {
        assert.deepEqual(leggiCookieSessione(COOKIE), {
            stato: 'valido',
            deviceId: DEVICE,
            token: TOKEN,
        });
    });

    test('fra altri cookie e con spazi', () => {
        assert.deepEqual(
            leggiCookieSessione(`tema=scuro;  ${COOKIE} ; lingua=it`),
            { stato: 'valido', deviceId: DEVICE, token: TOKEN },
        );
    });

    test('la tabulazione ai bordi delle coppie è ammessa (come lo spazio)', () => {
        for (const intestazione of [
            `\t${COOKIE}`,
            `${COOKIE}\t`,
            `\t${COOKIE}\t`,
            `tema=scuro;\t${COOKIE}`,
            `tema=scuro;\t${COOKIE}\t;\tlingua=it`,
            `tema=scuro; \t ${COOKIE} \t ; lingua=it`,
        ]) {
            assert.deepEqual(
                leggiCookieSessione(intestazione),
                { stato: 'valido', deviceId: DEVICE, token: TOKEN },
                JSON.stringify(intestazione),
            );
        }
    });

    test('device_id UUID con maiuscole (accettato come dal login bearer)', () => {
        const r = leggiCookieSessione(`waveset_sid=${DEVICE.toUpperCase()}.${TOKEN}`);

        assert.equal(r.stato, 'valido');
        assert.equal(r.deviceId, DEVICE.toUpperCase());
    });
});

describe('leggiCookieSessione: duplicato = non valido, mai "assente"', () => {
    test('due cookie waveset_sid con valori diversi', () => {
        const r = leggiCookieSessione(`${COOKIE}; waveset_sid=${DEVICE}.${'b'.repeat(64)}`);

        assert.deepEqual(r, { stato: 'non_valido', motivo: 'cookie duplicato' });
    });

    test('due cookie identici', () => {
        assert.equal(leggiCookieSessione(`${COOKIE}; ${COOKIE}`).stato, 'non_valido');
    });

    test('uno valido e uno malformato', () => {
        assert.equal(
            leggiCookieSessione(`${COOKIE}; waveset_sid=malformato`).motivo,
            'cookie duplicato',
        );
    });

    test('un cookie con nome simile non conta come duplicato', () => {
        assert.equal(leggiCookieSessione(`waveset_sid2=x; ${COOKIE}`).stato, 'valido');
    });
});

describe('leggiCookieSessione: malformato = non valido', () => {
    const MALFORMATI = [
        ['nome senza valore', 'waveset_sid'],
        ['valore vuoto', 'waveset_sid='],
        ['senza punto', `waveset_sid=${DEVICE}${TOKEN}`],
        ['solo il device_id', `waveset_sid=${DEVICE}`],
        ['solo il token', `waveset_sid=${TOKEN}`],
        ['token troppo corto', `waveset_sid=${DEVICE}.${'a'.repeat(63)}`],
        ['token troppo lungo', `waveset_sid=${DEVICE}.${'a'.repeat(65)}`],
        ['token in maiuscolo', `waveset_sid=${DEVICE}.${'A'.repeat(64)}`],
        ['token non esadecimale', `waveset_sid=${DEVICE}.${'g'.repeat(64)}`],
        ['device_id non UUID', `waveset_sid=non-un-uuid.${TOKEN}`],
        ['device_id vuoto', `waveset_sid=.${TOKEN}`],
        ['tre parti', `waveset_sid=${DEVICE}.${TOKEN}.extra`],
        ['con virgolette', `waveset_sid="${DEVICE}.${TOKEN}"`],
        ['con spazio interno', `waveset_sid=${DEVICE}. ${TOKEN}`],
        ['con un altro segno =', `waveset_sid=${DEVICE}.${TOKEN}=`],
        ['con a capo', `waveset_sid=${DEVICE}.${TOKEN}\n`],
    ];

    for (const [nome, intestazione] of MALFORMATI) {
        test(nome, () => {
            const r = leggiCookieSessione(intestazione);

            assert.equal(r.stato, 'non_valido', JSON.stringify(r));
            assert.ok(!('token' in r));
        });
    }

    describe('CR e LF rendono non valido il cookie', () => {
        const CASI = [
            ['LF alla fine', `${COOKIE}\n`],
            ['CR alla fine', `${COOKIE}\r`],
            ['CRLF alla fine', `${COOKIE}\r\n`],
            ['LF all\'inizio', `\n${COOKIE}`],
            ['CR all\'inizio', `\r${COOKIE}`],
            ['LF dentro il token', `waveset_sid=${DEVICE}.${'a'.repeat(32)}\n${'a'.repeat(32)}`],
            ['CR dentro il device_id', `waveset_sid=${DEVICE.slice(0, 8)}\r${DEVICE.slice(8)}.${TOKEN}`],
            ['LF dopo il punto e virgola', `tema=scuro;\n${COOKIE}`],
            ['CRLF fra due cookie', `${COOKIE};\r\nSet-Cookie: x=1`],
            ['LF nel valore di un altro cookie', `altro=a\nb; ${COOKIE}`],
            ['LF nel nome', `waveset_sid\n=${DEVICE}.${TOKEN}`],
            ['LF nell\'intestazione senza il nostro cookie', 'altro=a\nb'],
            ['solo LF', '\n'],
            ['solo CR', '\r'],
        ];

        for (const [nome, intestazione] of CASI) {
            test(nome, () => {
                const r = leggiCookieSessione(intestazione);

                assert.equal(r.stato, 'non_valido', JSON.stringify(r));
                assert.ok(!('token' in r));
                assert.ok(!('deviceId' in r));
            });
        }

        test('il motivo non riporta il contenuto dell\'intestazione', () => {
            const r = leggiCookieSessione(`${COOKIE}\r\nX-Iniettato: 1`);

            assert.ok(!JSON.stringify(r).includes('Iniettato'));
            assert.ok(!JSON.stringify(r).includes(TOKEN));
        });
    });

    test('altri spazi diversi da spazio e tabulazione non vengono tolti: cookie non valido', () => {
        for (const spazio of ['\f', '\v', ' ', ' ', '​']) {
            assert.equal(
                leggiCookieSessione(`${COOKIE}${spazio}`).stato,
                'non_valido',
                JSON.stringify(spazio),
            );
            assert.equal(
                leggiCookieSessione(`${spazio}${COOKIE}`).stato,
                'assente',
                JSON.stringify(spazio),
            );
        }
    });

    test('tabulazione dentro il valore: cookie non valido', () => {
        assert.equal(
            leggiCookieSessione(`waveset_sid=${DEVICE}.\t${TOKEN}`).stato,
            'non_valido',
        );
        assert.equal(
            leggiCookieSessione(`waveset_sid=${DEVICE}\t.${TOKEN}`).stato,
            'non_valido',
        );
    });

    test('intestazione che non è un testo', () => {
        for (const intestazione of [[COOKIE], 5, {}, true]) {
            assert.equal(leggiCookieSessione(intestazione).stato, 'non_valido');
        }
    });

    test('il motivo dell\'errore non contiene il valore del cookie', () => {
        const r = leggiCookieSessione(`waveset_sid=${DEVICE}.${'g'.repeat(64)}`);

        assert.ok(!JSON.stringify(r).includes('gggg'));
    });
});

describe('serializzaCookieSessione', () => {
    test('stringa esatta, senza Secure', () => {
        assert.equal(
            serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN }),
            `${COOKIE}; Max-Age=604800; Path=/api; HttpOnly; SameSite=Strict`,
        );
    });

    test('stringa esatta, con Secure', () => {
        assert.equal(
            serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN, sicuro: true }),
            `${COOKIE}; Max-Age=604800; Path=/api; HttpOnly; SameSite=Strict; Secure`,
        );
    });

    test('HttpOnly, SameSite=Strict, Path=/api, nessun Domain', () => {
        const { attributi } = analizza(
            serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN }),
        );

        assert.equal(attributi.get('httponly'), true);
        assert.equal(attributi.get('samesite'), 'Strict');
        assert.equal(attributi.get('path'), '/api');
        assert.equal(attributi.get('max-age'), '604800');
        assert.ok(!attributi.has('domain'));
        assert.ok(!attributi.has('secure'));
        assert.ok(!attributi.has('expires'));
    });

    test('Secure solo se richiesto', () => {
        const con = analizza(serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN, sicuro: true }));
        const senza = analizza(serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN, sicuro: false }));

        assert.equal(con.attributi.get('secure'), true);
        assert.ok(!senza.attributi.has('secure'));
        assert.ok(!con.attributi.has('domain'));
    });

    test('Max-Age personalizzato', () => {
        assert.equal(
            analizza(serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN, maxAgeSec: 60 })).attributi.get('max-age'),
            '60',
        );
    });

    test('andata e ritorno: quello che si scrive si rilegge identico', () => {
        const coppia = serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN }).split('; ')[0];

        assert.deepEqual(leggiCookieSessione(coppia), {
            stato: 'valido',
            deviceId: DEVICE,
            token: TOKEN,
        });
    });

    for (const [nome, parametri] of [
        ['device_id non UUID', { deviceId: 'x', token: TOKEN }],
        ['device_id con a capo', { deviceId: `${DEVICE}\r\nSet-Cookie: a=b`, token: TOKEN }],
        ['device_id assente', { token: TOKEN }],
        ['token corto', { deviceId: DEVICE, token: 'a'.repeat(63) }],
        ['token in maiuscolo', { deviceId: DEVICE, token: 'A'.repeat(64) }],
        ['token con a capo', { deviceId: DEVICE, token: `${'a'.repeat(63)}\n` }],
        ['token con punto e virgola', { deviceId: DEVICE, token: `${'a'.repeat(60)}; x=` }],
        ['token assente', { deviceId: DEVICE }],
        ['token non testo', { deviceId: DEVICE, token: 5 }],
        ['Max-Age zero', { deviceId: DEVICE, token: TOKEN, maxAgeSec: 0 }],
        ['Max-Age negativo', { deviceId: DEVICE, token: TOKEN, maxAgeSec: -1 }],
        ['Max-Age non intero', { deviceId: DEVICE, token: TOKEN, maxAgeSec: 1.5 }],
        ['Max-Age NaN', { deviceId: DEVICE, token: TOKEN, maxAgeSec: NaN }],
        ['Max-Age testo', { deviceId: DEVICE, token: TOKEN, maxAgeSec: '60' }],
    ]) {
        test(`rifiuta: ${nome}`, () => {
            assert.throws(() => serializzaCookieSessione(parametri), TypeError);
        });
    }
});

describe('cancellaCookieSessione: stesso Path e stessi attributi della creazione', () => {
    for (const sicuro of [false, true]) {
        test(`sicuro=${sicuro}: stringa esatta`, () => {
            assert.equal(
                cancellaCookieSessione({ sicuro }),
                `waveset_sid=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/api; HttpOnly; SameSite=Strict${sicuro ? '; Secure' : ''}`,
            );
        });

        test(`sicuro=${sicuro}: Path, HttpOnly, SameSite, Secure e assenza di Domain coincidono con la creazione`, () => {
            const creato = analizza(serializzaCookieSessione({ deviceId: DEVICE, token: TOKEN, sicuro })).attributi;
            const cancellato = analizza(cancellaCookieSessione({ sicuro })).attributi;

            for (const nome of ['path', 'httponly', 'samesite', 'secure', 'domain']) {
                assert.equal(cancellato.get(nome), creato.get(nome), nome);
            }
            assert.ok(!cancellato.has('domain'));
        });
    }

    test('scade subito e ha valore vuoto', () => {
        const { coppia, attributi } = analizza(cancellaCookieSessione());

        assert.equal(coppia, 'waveset_sid=');
        assert.equal(attributi.get('max-age'), '0');
        assert.equal(attributi.get('expires'), 'Thu, 01 Jan 1970 00:00:00 GMT');
    });

    test('senza argomenti: non Secure', () => {
        assert.ok(!analizza(cancellaCookieSessione()).attributi.has('secure'));
    });

    test('il cookie cancellato, riletto, non è un cookie valido né assente per errore', () => {
        // Un client che rispedisse "waveset_sid=" ottiene "non valido", non una sessione.
        assert.equal(leggiCookieSessione('waveset_sid=').stato, 'non_valido');
    });
});

describe('cookieSicuro: Secure secondo la configurazione o se la richiesta è HTTPS', () => {
    test('forzato dalla configurazione', () => {
        assert.equal(cookieSicuro({ forzato: true, richiestaHttps: false }), true);
    });

    test('richiesta HTTPS: sempre Secure, anche senza forzatura', () => {
        assert.equal(cookieSicuro({ forzato: false, richiestaHttps: true }), true);
        assert.equal(cookieSicuro({ richiestaHttps: true }), true);
    });

    test('né forzato né HTTPS: non Secure', () => {
        assert.equal(cookieSicuro({ forzato: false, richiestaHttps: false }), false);
        assert.equal(cookieSicuro({}), false);
        assert.equal(cookieSicuro(), false);
    });

    test('solo booleani veri: testi e numeri non attivano Secure', () => {
        assert.equal(cookieSicuro({ forzato: 'true', richiestaHttps: 1 }), false);
    });
});
