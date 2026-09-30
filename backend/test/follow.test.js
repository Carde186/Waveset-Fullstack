// Follow utente -> artista: endpoint protetti, flag "seguito" nel dettaglio
// artista, isolamento tra due utenti reali.

const assert = require('node:assert/strict');
const { after, before, describe, test } = require('node:test');

const { UTENTE_A, UTENTE_B, chiama, accedi, chiudi } = require('./aiuto');

// Artisti che nel seed l'utente A non segue: il test li segue e alla fine
// li rimette com'erano.
const ARTISTA = 2;
const ALTRO_ARTISTA = 4;

let utenteA;
let utenteB;

before(async () => {
    utenteA = await accedi(UTENTE_A);
    utenteB = await accedi(UTENTE_B);
});

after(async () => {
    for (const id of [ARTISTA, ALTRO_ARTISTA]) {
        await chiama(`/artisti/${id}/segui`, {
            metodo: 'DELETE',
            sessione: utenteA,
        });
    }
    await chiudi();
});

async function seguito(id, sessione) {
    const { dati } = await chiama(`/artisti/${id}`, { sessione });
    return dati.seguito;
}

describe('follow', () => {
    test('da anonimo "seguito" è false e seguire richiede la sessione', async () => {
        assert.equal(await seguito(ARTISTA), false);

        const put = await chiama(`/artisti/${ARTISTA}/segui`, {
            metodo: 'PUT',
        });
        const del = await chiama(`/artisti/${ARTISTA}/segui`, {
            metodo: 'DELETE',
        });
        assert.equal(put.stato, 401);
        assert.equal(del.stato, 401);
    });

    test('seguire e smettere di seguire, in modo idempotente', async () => {
        const segui = () =>
            chiama(`/artisti/${ARTISTA}/segui`, {
                metodo: 'PUT',
                sessione: utenteA,
            });
        const smetti = () =>
            chiama(`/artisti/${ARTISTA}/segui`, {
                metodo: 'DELETE',
                sessione: utenteA,
            });

        assert.equal((await segui()).stato, 204);
        assert.equal((await segui()).stato, 204);
        assert.equal(await seguito(ARTISTA, utenteA), true);

        assert.equal((await smetti()).stato, 204);
        assert.equal((await smetti()).stato, 204);
        assert.equal(await seguito(ARTISTA, utenteA), false);
    });

    test('artista inesistente: 404', async () => {
        const risposta = await chiama('/artisti/999999/segui', {
            metodo: 'PUT',
            sessione: utenteA,
        });

        assert.equal(risposta.stato, 404);
    });

    test('isolamento: i follow di A non valgono per B', async () => {
        await chiama(`/artisti/${ALTRO_ARTISTA}/segui`, {
            metodo: 'PUT',
            sessione: utenteA,
        });

        assert.equal(await seguito(ALTRO_ARTISTA, utenteA), true);
        assert.equal(await seguito(ALTRO_ARTISTA, utenteB), false);
        assert.equal(await seguito(ALTRO_ARTISTA), false);

        // E B non può togliere il follow di A: DELETE agisce solo sui propri.
        await chiama(`/artisti/${ALTRO_ARTISTA}/segui`, {
            metodo: 'DELETE',
            sessione: utenteB,
        });
        assert.equal(await seguito(ALTRO_ARTISTA, utenteA), true);
    });

    test('sessione non valida sul dettaglio: si prosegue da anonimi', async () => {
        const falsa = { ...utenteA, token: 'f'.repeat(64) };
        const risposta = await chiama(`/artisti/${ARTISTA}`, {
            sessione: falsa,
        });

        assert.equal(risposta.stato, 200);
        assert.equal(risposta.dati.seguito, false);
    });
});
