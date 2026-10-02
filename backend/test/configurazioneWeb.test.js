// Configurazione della sessione browser: una configurazione non valida
// DISABILITA solo il web e non impedisce l'avvio del backend (né il login
// bearer dell'app Android). Nessun DB né rete (il file non importa aiuto.js).

const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const {
    configurazioneWebDaAmbiente,
} = require('../src/autenticazione/configurazioneWeb');

const VALIDA = { FRONTEND_ORIGINS: 'http://localhost:5173' };

describe('configurazione valida: sessione web abilitata', () => {
    test('una origine, COOKIE_SECURE assente', () => {
        const c = configurazioneWebDaAmbiente(VALIDA);

        assert.equal(c.abilitata, true);
        assert.deepEqual([...c.origini], ['http://localhost:5173']);
        assert.equal(c.cookieSicuroForzato, false);
        assert.deepEqual(c.motivi, []);
    });

    test('più origini normalizzate', () => {
        const c = configurazioneWebDaAmbiente({
            FRONTEND_ORIGINS: 'http://localhost:5173, HTTPS://App.Esempio.it:443',
        });

        assert.equal(c.abilitata, true);
        assert.deepEqual([...c.origini], [
            'http://localhost:5173',
            'https://app.esempio.it',
        ]);
    });

    test('COOKIE_SECURE=true forza Secure', () => {
        const c = configurazioneWebDaAmbiente({ ...VALIDA, COOKIE_SECURE: 'true' });

        assert.equal(c.abilitata, true);
        assert.equal(c.cookieSicuroForzato, true);
    });

    test('COOKIE_SECURE=false o vuoto: non forzato, web abilitato', () => {
        for (const COOKIE_SECURE of ['false', '']) {
            const c = configurazioneWebDaAmbiente({ ...VALIDA, COOKIE_SECURE });

            assert.equal(c.abilitata, true);
            assert.equal(c.cookieSicuroForzato, false);
        }
    });

    test('NODE_ENV diverso da production non richiede COOKIE_SECURE', () => {
        for (const NODE_ENV of ['development', 'test', '', undefined]) {
            assert.equal(configurazioneWebDaAmbiente({ ...VALIDA, NODE_ENV }).abilitata, true);
        }
    });

    test('produzione con COOKIE_SECURE=true: abilitata', () => {
        const c = configurazioneWebDaAmbiente({
            FRONTEND_ORIGINS: 'https://app.esempio.it',
            NODE_ENV: 'production',
            COOKIE_SECURE: 'true',
        });

        assert.equal(c.abilitata, true);
    });
});

describe('configurazione assente o non valida: web DISABILITATO, senza eccezioni', () => {
    test('FRONTEND_ORIGINS assente o vuota', () => {
        for (const env of [{}, { FRONTEND_ORIGINS: '' }, { FRONTEND_ORIGINS: '   ' }]) {
            const c = configurazioneWebDaAmbiente(env);

            assert.equal(c.abilitata, false);
            assert.equal(c.origini.size, 0);
            assert.deepEqual(c.motivi, ['FRONTEND_ORIGINS non impostata']);
        }
    });

    for (const FRONTEND_ORIGINS of [
        '*',
        'null',
        'http://localhost:5173/',
        'http://localhost:5173/app',
        'localhost:5173',
        'https://*.esempio.it',
        'http://esempio.it',
        'http://localhost:5173,',
        'http://localhost:5173,*',
    ]) {
        test(`FRONTEND_ORIGINS non valida: ${JSON.stringify(FRONTEND_ORIGINS)}`, () => {
            const c = configurazioneWebDaAmbiente({ FRONTEND_ORIGINS });

            assert.equal(c.abilitata, false);
            assert.equal(c.origini.size, 0); // mai una configurazione a metà
            assert.ok(c.motivi.length > 0);
            assert.ok(c.motivi.every(m => m.startsWith('FRONTEND_ORIGINS')));
        });
    }

    for (const COOKIE_SECURE of ['yes', '1', 'TRUE', 'True', 'si', ' true', 'true ', '0']) {
        test(`COOKIE_SECURE non valido: ${JSON.stringify(COOKIE_SECURE)}`, () => {
            const c = configurazioneWebDaAmbiente({ ...VALIDA, COOKIE_SECURE });

            assert.equal(c.abilitata, false);
            assert.equal(c.origini.size, 0);
            assert.ok(c.motivi.some(m => m.startsWith('COOKIE_SECURE non valido')));
        });
    }

    test('produzione senza COOKIE_SECURE=true: web disabilitato (il backend non si ferma)', () => {
        for (const COOKIE_SECURE of [undefined, '', 'false']) {
            const c = configurazioneWebDaAmbiente({
                FRONTEND_ORIGINS: 'https://app.esempio.it',
                NODE_ENV: 'production',
                COOKIE_SECURE,
            });

            assert.equal(c.abilitata, false);
            assert.deepEqual(c.motivi, ['in produzione COOKIE_SECURE deve essere true']);
        }
    });

    test('i motivi si sommano', () => {
        const c = configurazioneWebDaAmbiente({
            FRONTEND_ORIGINS: '*',
            COOKIE_SECURE: 'forse',
            NODE_ENV: 'production',
        });

        assert.equal(c.abilitata, false);
        assert.equal(c.motivi.length, 3);
    });

    test('non lancia mai, qualunque sia l\'ambiente', () => {
        for (const env of [
            undefined,
            null,
            5,
            'testo',
            [],
            { FRONTEND_ORIGINS: 5 },
            { FRONTEND_ORIGINS: {} },
            { FRONTEND_ORIGINS: ['http://localhost:5173'] },
            { FRONTEND_ORIGINS: 'x'.repeat(100_000) },
            { ...VALIDA, COOKIE_SECURE: {} },
            { ...VALIDA, COOKIE_SECURE: 5 },
            { ...VALIDA, NODE_ENV: 5 },
        ]) {
            const c = configurazioneWebDaAmbiente(env);

            assert.equal(typeof c.abilitata, 'boolean');
            assert.ok(Array.isArray(c.motivi));
            assert.ok(c.origini instanceof Set);
            if (!c.abilitata) {
                assert.equal(c.origini.size, 0);
                assert.ok(c.motivi.length > 0);
            }
        }
    });

    test('un valore enorme non finisce per intero nei motivi', () => {
        const c = configurazioneWebDaAmbiente({
            FRONTEND_ORIGINS: `https://${'x'.repeat(50_000)}.it`,
            COOKIE_SECURE: 'y'.repeat(50_000),
        });

        assert.ok(c.motivi.join('').length < 1000);
    });

    test('non modifica l\'ambiente ricevuto', () => {
        const env = Object.freeze({ FRONTEND_ORIGINS: '*', COOKIE_SECURE: 'boh' });

        assert.doesNotThrow(() => configurazioneWebDaAmbiente(env));
    });
});

describe('il backend parte e risponde anche con la configurazione web non valida', () => {
    // L'app legge questa configurazione (trasporto cookie e protezione CSRF):
    // con valori non validi la sessione web si disabilita (con un avviso su
    // stderr), il backend parte e il bearer non cambia. Che il cookie non
    // autentichi nessuno è provato in sessioneCookie.test.js.
    test('creaApp() non fallisce e le route bearer rispondono come sempre', async () => {
        const salvate = {};
        const impostate = { FRONTEND_ORIGINS: '*', COOKIE_SECURE: 'forse' };

        for (const [nome, valore] of Object.entries(impostate)) {
            salvate[nome] = process.env[nome];
            process.env[nome] = valore;
        }

        const creaApp = require('../src/app');
        const poolApp = require('../src/config/database');
        let server;

        try {
            server = creaApp().listen(0);
            await new Promise(risolvi => server.once('listening', risolvi));
            const base = `http://127.0.0.1:${server.address().port}/api`;

            // Login bearer senza corpo: 400 di sempre, senza toccare il database.
            const login = await fetch(`${base}/auth/login`, { method: 'POST' });
            assert.equal(login.status, 400);
            assert.deepEqual(await login.json(), {
                messaggio: 'email, password e X-Device-Id obbligatori',
            });

            assert.equal((await fetch(`${base}/inesistente`)).status, 404);
        } finally {
            for (const [nome, valore] of Object.entries(salvate)) {
                if (valore === undefined) {
                    delete process.env[nome];
                } else {
                    process.env[nome] = valore;
                }
            }
            if (server) {
                await new Promise(risolvi => server.close(risolvi));
            }
            await poolApp.end();
        }
    });
});
