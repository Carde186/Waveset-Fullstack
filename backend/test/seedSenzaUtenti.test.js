// Nessuno script versionato in db/init crea utenti: su un ambiente
// inizializzato da zero non esistono USER predefiniti (né altri account); l'ADMIN
// lo crea scripts/creaAdmin.js con credenziali locali. Test statico: legge i
// file, non usa DB né rete (per questo non importa aiuto.js).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, test } = require('node:test');

const CARTELLA_INIT = path.join(__dirname, '..', 'db', 'init');

// INSERT / REPLACE su `utente` (con o senza IGNORE e apici inversi). Non deve
// scattare su utente_artista: il lookahead esclude ogni carattere di parola.
const SCRITTURA_UTENTE = /\b(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+`?utente`?(?!\w)/i;

function senzaCommenti(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(riga => riga.replace(/--.*$/, ''))
        .join('\n');
}

describe('seed versionati di db/init', () => {
    const file = fs.readdirSync(CARTELLA_INIT).filter(n => n.endsWith('.sql'));

    test('la cartella contiene gli script attesi', () => {
        assert.ok(file.length > 0);
        assert.ok(file.includes('03_playlist_schema.sql'));
    });

    for (const nome of file) {
        test(`${nome} non crea utenti`, () => {
            const sql = senzaCommenti(
                fs.readFileSync(path.join(CARTELLA_INIT, nome), 'utf8'),
            );

            assert.ok(!SCRITTURA_UTENTE.test(sql));
        });
    }

    test('il controllo riconosce una scrittura su utente e ignora utente_artista', () => {
        assert.ok(SCRITTURA_UTENTE.test('INSERT INTO utente (id) VALUES (1);'));
        assert.ok(SCRITTURA_UTENTE.test('insert ignore into `utente` (id) VALUES (1);'));
        assert.ok(SCRITTURA_UTENTE.test('REPLACE INTO utente VALUES (1);'));
        assert.ok(!SCRITTURA_UTENTE.test('INSERT INTO utente_artista VALUES (1, 1);'));
        assert.ok(!SCRITTURA_UTENTE.test('CREATE TABLE utente (id INT);'));
    });
});
