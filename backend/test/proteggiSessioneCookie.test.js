// Middleware CSRF/Origin: matrice di decisioni con richieste e risposte finte.
// Nessun DB né rete (il file non importa aiuto.js). La prova HTTP con sessioni
// vere è in sessioneCookie.test.js.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, test } = require('node:test');

const { generaCsrf } = require('../src/autenticazione/csrf');
const {
    MESSAGGIO_403,
    proteggiSessioneCookie,
} = require('../src/autenticazione/proteggiSessioneCookie');

const ORIGINE = 'http://localhost:5173';
const DEVICE = crypto.randomUUID();
const TOKEN = crypto.randomBytes(32).toString('hex');
const ALTRO_TOKEN = crypto.randomBytes(32).toString('hex');
const COOKIE = `waveset_sid=${DEVICE}.${TOKEN}`;
const CSRF = generaCsrf(TOKEN);

const WEB_ABILITATA = {
    abilitata: true,
    origini: new Set([ORIGINE]),
    cookieSicuroForzato: false,
    motivi: [],
};
const WEB_DISABILITATA = { abilitata: false, origini: new Set(), motivi: ['x'] };

// `web` assente = sessione web abilitata; `web: undefined` (o null) arriva
// invece davvero al middleware, per provare l'app senza configurazione.
function richiesta(opzioni = {}) {
    const { metodo = 'POST', intestazioni = {}, percorso = '/playlist' } = opzioni;
    const web = Object.hasOwn(opzioni, 'web') ? opzioni.web : WEB_ABILITATA;
    const h = {};

    for (const [nome, valore] of Object.entries(intestazioni)) {
        h[nome.toLowerCase()] = valore;
    }

    return {
        method: metodo,
        baseUrl: '/api',
        path: percorso, // relativo a /api, come dentro app.use('/api', ...)
        app: { locals: { configurazioneWeb: web } },
        get: nome => h[nome.toLowerCase()],
    };
}

function esegui(req) {
    const res = {
        stato: null,
        corpo: null,
        status(codice) {
            this.stato = codice;
            return this;
        },
        json(corpo) {
            this.corpo = corpo;
            return this;
        },
    };
    let passata = false;

    proteggiSessioneCookie(req, res, () => {
        passata = true;
    });

    return { passata, res };
}

const COMPLETA = { Cookie: COOKIE, Origin: ORIGINE, 'X-CSRF-Token': CSRF };

// Il messaggio si passa ad assert solo se c'è: con un terzo argomento
// `undefined`, Node lancia un TypeError che nasconde la differenza vera.
function conMessaggio(messaggio) {
    return messaggio === undefined ? [] : [messaggio];
}

function assertPassa(req, messaggio) {
    const { passata, res } = esegui(req);

    assert.equal(passata, true, ...conMessaggio(messaggio));
    assert.equal(res.stato, null, ...conMessaggio(messaggio));
}

function assert403(req, messaggio) {
    const { passata, res } = esegui(req);

    assert.equal(passata, false, ...conMessaggio(messaggio));
    assert.equal(res.stato, 403, ...conMessaggio(messaggio));
    assert.deepEqual(res.corpo, { messaggio: MESSAGGIO_403 }, ...conMessaggio(messaggio));
}

describe('mutazione con cookie di sessione: Origin ammesso E CSRF valido', () => {
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        test(`${metodo} con cookie, Origin ammesso e CSRF valido: passa`, () => {
            assertPassa(richiesta({ metodo, intestazioni: COMPLETA }));
        });
    }

    test('anche un metodo insolito è trattato come non sicuro', () => {
        for (const metodo of ['TRACE', 'PROPFIND', 'LINK']) {
            assert403(richiesta({ metodo, intestazioni: { Cookie: COOKIE } }), metodo);
        }
    });

    describe('Origin assente o errato: 403 (anche con CSRF valido)', () => {
        const ORIGINI_ERRATE = [
            undefined,
            '',
            'null',
            '*',
            'http://evil.example',
            'http://localhost:5173.evil.example',
            'http://localhost:5173/',
            'http://xlocalhost:5173',
            'http://localhost:51730',
            'http://localhost',
            'https://localhost:5173',
            'HTTP://LOCALHOST:5173',
            ' http://localhost:5173',
        ];

        for (const origine of ORIGINI_ERRATE) {
            test(`Origin ${JSON.stringify(origine) ?? 'assente'}`, () => {
                const intestazioni = { Cookie: COOKIE, 'X-CSRF-Token': CSRF };

                if (origine !== undefined) {
                    intestazioni.Origin = origine;
                }
                assert403(richiesta({ intestazioni }));
            });
        }
    });

    describe('token CSRF assente o errato: 403 (anche con Origin ammesso)', () => {
        const FLIP = `${CSRF.slice(0, 63)}${CSRF.endsWith('0') ? '1' : '0'}`;
        const CSRF_ERRATI = [
            undefined,
            '',
            FLIP,
            CSRF.slice(0, 63),
            `${CSRF}0`,
            CSRF.toUpperCase(),
            ` ${CSRF}`,
            TOKEN, // il token di sessione non vale come CSRF
            generaCsrf(ALTRO_TOKEN), // il CSRF di un'altra sessione
            'x'.repeat(100_000),
        ];

        for (const csrf of CSRF_ERRATI) {
            test(`CSRF ${JSON.stringify(csrf)?.slice(0, 40) ?? 'assente'}`, () => {
                const intestazioni = { Cookie: COOKIE, Origin: ORIGINE };

                if (csrf !== undefined) {
                    intestazioni['X-CSRF-Token'] = csrf;
                }
                assert403(richiesta({ intestazioni }));
            });
        }
    });

    test('Origin e CSRF assenti insieme: 403', () => {
        assert403(richiesta({ intestazioni: { Cookie: COOKIE } }));
    });

    test('la risposta è la stessa per ogni motivo di rifiuto (nessun indizio su quale controllo è fallito)', () => {
        const casi = [
            { Cookie: COOKIE },
            { Cookie: COOKIE, Origin: ORIGINE },
            { Cookie: COOKIE, 'X-CSRF-Token': CSRF },
            { Cookie: COOKIE, Origin: 'http://evil.example', 'X-CSRF-Token': CSRF },
            { Cookie: COOKIE, Origin: ORIGINE, 'X-CSRF-Token': 'sbagliato' },
            { Cookie: 'waveset_sid=malformato', Origin: ORIGINE, 'X-CSRF-Token': CSRF },
        ];
        const corpi = casi.map(intestazioni => esegui(richiesta({ intestazioni })).res.corpo);

        for (const corpo of corpi) {
            assert.deepEqual(corpo, { messaggio: MESSAGGIO_403 });
        }
    });

    test('il 403 non rivela né il token né altro', () => {
        const { res } = esegui(richiesta({ intestazioni: { Cookie: COOKIE } }));
        const testo = JSON.stringify(res.corpo);

        assert.ok(!testo.includes(TOKEN));
        assert.ok(!testo.includes(CSRF));
        assert.ok(!testo.includes(DEVICE));
    });
});

describe('cookie duplicato o malformato su una mutazione: 403, mai "assente"', () => {
    const CASI = [
        ['duplicato', `${COOKIE}; ${COOKIE}`],
        ['duplicato con valori diversi', `${COOKIE}; waveset_sid=${DEVICE}.${ALTRO_TOKEN}`],
        ['senza valore', 'waveset_sid'],
        ['vuoto', 'waveset_sid='],
        ['token corto', `waveset_sid=${DEVICE}.abc`],
        ['device_id non UUID', `waveset_sid=x.${TOKEN}`],
        ['con a capo', `${COOKIE}\r\n`],
    ];

    for (const [nome, cookie] of CASI) {
        test(`${nome}, anche con Origin e CSRF`, () => {
            assert403(
                richiesta({
                    intestazioni: { Cookie: cookie, Origin: ORIGINE, 'X-CSRF-Token': CSRF },
                }),
            );
        });
    }
});

describe('richieste che il middleware NON tocca', () => {
    test('metodi sicuri con cookie e senza Origin né CSRF: passano', () => {
        for (const metodo of ['GET', 'HEAD', 'OPTIONS']) {
            assertPassa(richiesta({ metodo, intestazioni: { Cookie: COOKIE } }), metodo);
        }
    });

    test('metodi sicuri con un cookie malformato: passano (decide poi trovaSessione)', () => {
        assertPassa(richiesta({ metodo: 'GET', intestazioni: { Cookie: 'waveset_sid=x' } }));
    });

    test('Authorization presente = solo bearer: la mutazione passa senza Origin né CSRF', () => {
        for (const authorization of ['Bearer abc', 'Bearer', '', 'Basic abc', 'x']) {
            assertPassa(
                richiesta({ intestazioni: { Cookie: COOKIE, Authorization: authorization } }),
                JSON.stringify(authorization),
            );
        }
    });

    test('nessun cookie o cookie non nostri: passa', () => {
        for (const intestazioni of [
            {},
            { Cookie: '' },
            { Cookie: 'tema=scuro' },
            { Cookie: 'a=1; b=2' },
            { Cookie: `WAVESET_SID=${DEVICE}.${TOKEN}` }, // altro nome: maiuscole distinte
            { Cookie: `waveset_sid2=${DEVICE}.${TOKEN}` },
        ]) {
            assertPassa(richiesta({ intestazioni }), JSON.stringify(intestazioni));
        }
    });

    test('sessione web NON configurata: nessuna protezione, passa com\'era', () => {
        for (const web of [WEB_DISABILITATA, undefined, null, {}]) {
            assertPassa(richiesta({ web, intestazioni: { Cookie: COOKIE } }));
            assertPassa(richiesta({ web, intestazioni: { Cookie: 'waveset_sid=x' } }));
        }
    });

    test('app senza locals: passa (nessuna eccezione)', () => {
        const res = { status() { throw new Error('non deve rispondere'); } };
        let passata = false;

        proteggiSessioneCookie(
            { method: 'POST', app: undefined, get: () => undefined },
            res,
            () => {
                passata = true;
            },
        );

        assert.equal(passata, true);
    });
});

describe('unica eccezione: POST /api/auth/web/login (nessun CSRF, ma solo lì)', () => {
    const LOGIN_WEB = '/auth/web/login';

    test('POST web/login con un cookie vecchio e senza Origin né CSRF: passa (il controllo Origin è del gestore)', () => {
        for (const cookie of [
            COOKIE,
            `waveset_sid=${DEVICE}.${ALTRO_TOKEN}`,
            'waveset_sid=malformato',
            `${COOKIE}; ${COOKIE}`,
            'waveset_sid=',
        ]) {
            assertPassa(
                richiesta({ percorso: LOGIN_WEB, intestazioni: { Cookie: cookie } }),
                cookie,
            );
        }
    });

    test('passa anche con Origin sbagliato: il middleware non controlla l\'Origin qui, lo fa il gestore', () => {
        assertPassa(
            richiesta({ percorso: LOGIN_WEB, intestazioni: { Cookie: COOKIE, Origin: 'http://evil.example' } }),
        );
    });

    test('ogni variante del percorso NON è esente: 403 senza CSRF', () => {
        for (const percorso of [
            '/auth/web/login/',
            '/auth/web/login/altro',
            '/auth/web/logout',
            '/auth/web/Login',
            '/auth/WEB/login',
            '/AUTH/web/login',
            '/auth/web',
            '/auth/login',
            '/auth/web/login.json',
            '//auth/web/login',
            '/web/login',
        ]) {
            assert403(richiesta({ percorso, intestazioni: { Cookie: COOKIE } }), percorso);
        }
    });

    test('solo il metodo POST è esente: gli altri metodi non sicuri su quel percorso sono 403', () => {
        for (const metodo of ['PUT', 'PATCH', 'DELETE', 'TRACE']) {
            assert403(richiesta({ metodo, percorso: LOGIN_WEB, intestazioni: { Cookie: COOKIE } }), metodo);
        }
    });

    test('un baseUrl diverso non è esente', () => {
        const req = richiesta({ percorso: LOGIN_WEB, intestazioni: { Cookie: COOKIE } });

        req.baseUrl = '/altro';
        assert403(req);
    });

    test('con la sessione web non configurata resta tutto com\'era (passa, ma il gestore risponde 503)', () => {
        assertPassa(richiesta({ web: WEB_DISABILITATA, percorso: LOGIN_WEB, intestazioni: { Cookie: COOKIE } }));
    });
});
