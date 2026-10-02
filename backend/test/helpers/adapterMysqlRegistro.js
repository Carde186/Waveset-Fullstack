'use strict';
const { randomBytes } = require('node:crypto');
const { SCHEMA } = require('./registroFixture');
// Candidato non integrato. Il registro è l'unica fonte di proprietà delle PK.
const ORDINE = Object.freeze(['playlist_brano', 'evento_artista', 'artista_genere', 'utente_artista',
    'sessioni', 'playlist', 'brano', 'album', 'evento', 'artista', 'genere', 'utente']);
const COLONNE = Object.freeze({
    genere: 'id:int nome:varchar',
    artista: 'id:int nome:varchar bio:text immagine_url:varchar id_ticketmaster:varchar immagine_autore:varchar immagine_licenza:varchar immagine_fonte_url:varchar immagine_modificata:tinyint',
    album: 'id:int titolo:varchar data_pubblicazione:date artista_id:int copertina_url:varchar',
    brano: 'id:int titolo:varchar artista_id:int album_id:int data_pubblicazione:date url_spotify:varchar collaboratori:varchar',
    utente: 'id:int nome:varchar email:varchar password_hash:char ruolo:enum',
    playlist: 'id:int nome:varchar utente_id:int',
    evento: 'id:int titolo:varchar data_evento:date ora_evento:time luogo:varchar citta:varchar latitudine:decimal longitudine:decimal fonte:enum id_esterno:varchar stato:enum motivo_revisione:varchar',
    sessioni: 'id:int utente_id:int hash_token:char device_id:varchar scadenza:datetime creata_il:timestamp',
    artista_genere: 'artista_id:int genere_id:int',
    playlist_brano: 'playlist_id:int brano_id:int aggiunto_il:timestamp',
    evento_artista: 'evento_id:int artista_id:int id_attraction_ticketmaster:varchar',
    utente_artista: 'utente_id:int artista_id:int',
});
const tabelle = Object.keys(SCHEMA);
const campi = t => [...new Set([...SCHEMA[t].pk, ...Object.keys(SCHEMA[t].fk)])];
const selezioni = Object.freeze(Object.fromEntries(tabelle.map(t => [t, `SELECT ${campi(t).join(', ')} FROM ${t} FOR UPDATE`])));
const deletes = Object.freeze(Object.fromEntries(tabelle.map(t => [t, `DELETE FROM ${t} WHERE ${SCHEMA[t].pk.map(c => `${c} = ?`).join(' AND ')}`])));
const copia = x => structuredClone(x);
const uguale = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const richiedi = (ok, codice) => { if (!ok) throw new Error(codice); };
const chiave = (t, pk) => `${t}:${JSON.stringify(pk)}`;
const descrizione = t => COLONNE[t].split(' ').map(x => x.split(':'));
// Campo: NULL -> N; valore -> V<numero byte>:<HEX maiuscolo>;
// Il numero di colonne e il loro ordine sono fissi e verificati dai metadati.
function codificaSQL(espressione, sorgente = espressione) {
    const b = `CAST(${espressione} AS BINARY)`;
    return `IF(${sorgente} IS NULL, 'N;', CONCAT('V', OCTET_LENGTH(${b}), ':', HEX(${b}), ';'))`;
}
function serializzazioneSQL(t) {
    const pezzi = descrizione(t).map(([c, tipo]) => {
        const e = tipo === 'date' ? `DATE_FORMAT(${c}, '%Y-%m-%d')` :
            ['datetime', 'timestamp'].includes(tipo) ? `DATE_FORMAT(${c}, '%Y-%m-%dT%H:%i:%s.%f')` :
                ['time', 'decimal'].includes(tipo) ? `CAST(${c} AS CHAR CHARACTER SET ascii)` : c;
        return codificaSQL(e, c);
    });
    return `CONCAT('v3:${t};', ${pezzi.join(', ')})`;
}
function snapshotSQL(t, blocca) {
    return `SELECT ${campi(t).join(', ')}, SHA2(CONCAT(CAST(? AS BINARY), CAST(${serializzazioneSQL(t)} AS BINARY)), 256) AS impronta FROM ${t} ORDER BY ${SCHEMA[t].pk.join(', ')}${blocca ? ' FOR UPDATE' : ''}`;
}
const SQL = Object.freeze({
    database: 'SELECT DATABASE() AS db',
    timezone: "SET SESSION time_zone = '+00:00'",
    charset: 'SET NAMES utf8mb4',
    ripetibile: 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    baseline: 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
    serializzabile: 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    tabelle: 'SELECT TABLE_NAME AS tabella, ENGINE AS motore, TABLE_TYPE AS tipo FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    colonne: 'SELECT TABLE_NAME AS tabella, COLUMN_NAME AS colonna, DATA_TYPE AS tipo, DATETIME_PRECISION AS temporale, NUMERIC_PRECISION AS precisione, NUMERIC_SCALE AS scala FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
    pk: "SELECT TABLE_NAME AS tabella, COLUMN_NAME AS colonna FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND INDEX_NAME = 'PRIMARY' ORDER BY TABLE_NAME, SEQ_IN_INDEX",
    fk: 'SELECT k.TABLE_SCHEMA AS schema_figlio, k.TABLE_NAME AS figlio, k.COLUMN_NAME AS colonna, k.REFERENCED_TABLE_SCHEMA AS schema_padre, k.REFERENCED_TABLE_NAME AS padre, k.REFERENCED_COLUMN_NAME AS pk, r.DELETE_RULE AS regola FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.REFERENCED_TABLE_NAME IS NOT NULL AND (k.TABLE_SCHEMA = ? OR k.REFERENCED_TABLE_SCHEMA = ?) ORDER BY k.TABLE_NAME, k.COLUMN_NAME',
    trigger: 'SELECT COUNT(*) AS totale FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
});
function verificaMetadati(m) {
    richiedi(uguale(m.tabelle, tabelle.slice().sort().map(tabella => ({ tabella, motore: 'InnoDB', tipo: 'BASE TABLE' }))), 'SCHEMA_TABELLE');
    richiedi(uguale(m.colonne.map(r => [r.tabella, r.colonna, r.tipo]), tabelle.slice().sort().flatMap(t => descrizione(t).map(([c, tipo]) => [t, c, tipo]))), 'SCHEMA_COLONNE');
    richiedi(m.colonne.every(r => !['time', 'datetime', 'timestamp'].includes(r.tipo) || r.temporale === 0), 'SCHEMA_PRECISIONE_TEMPORALE');
    richiedi(m.colonne.every(r => r.tipo !== 'decimal' || (r.precisione === 9 && r.scala === 6)), 'SCHEMA_PRECISIONE_DECIMALE');
    richiedi(uguale(m.pk.map(r => [r.tabella, r.colonna]), tabelle.slice().sort().flatMap(t => SCHEMA[t].pk.map(c => [t, c]))), 'SCHEMA_PK');
    const firma = r => [r.schema_figlio, r.figlio, r.colonna, r.schema_padre, r.padre, r.pk, r.regola].join(':');
    const attese = tabelle.flatMap(t => Object.entries(SCHEMA[t].fk).map(([c, padre]) => firma({ schema_figlio: 'waveset_test', figlio: t, colonna: c, schema_padre: 'waveset_test', padre, pk: 'id', regola: t === 'brano' && c === 'album_id' ? 'SET NULL' : 'CASCADE' })));
    richiedi(uguale(m.fk.map(firma).sort(), attese.sort()), 'SCHEMA_FK');
    richiedi(m.trigger.length === 1 && m.trigger[0].totale === 0, 'SCHEMA_TRIGGER');
}
function normalizza(stato) {
    return tabelle.flatMap(t => stato[t].map(r => [chiave(t, SCHEMA[t].pk.map(c => r[c])),
        [...campi(t).map(c => r[c]), r.impronta]])).sort((a, b) => a[0].localeCompare(b[0]));
}
async function creaAdapterMysqlRegistro({ pool, guardia, urlApi, ambiente = process.env }) {
    // L'integrazione futura deve caricare preparaAmbiente PRIMA di creare il pool.
    // ambiente è iniettato nei soli test offline; nessuna modifica a process.env.
    richiedi(guardia?.DB_TEST === 'waveset_test' && typeof guardia.verificaUrlAmmesso === 'function', 'GUARDIA_ASSENTE');
    richiedi(ambiente.DB_NAME === guardia.DB_TEST && ambiente.DB_HOST === '127.0.0.1' && /^\d+$/.test(ambiente.MYSQL_HOST_PORT || '') && ambiente.DB_PORT === ambiente.MYSQL_HOST_PORT, 'AMBIENTE_NON_TEST');
    richiedi(['DB_USER', 'DB_PASSWORD', 'BACKEND_HOST_PORT'].every(k => Boolean(ambiente[k])), 'AMBIENTE_INCOMPLETO');
    // Non propagare errori della guardia: possono contenere URL o ambiente.
    try { guardia.verificaUrlAmmesso(urlApi); } catch { throw new Error('URL_NON_TEST'); }
    let conn;
    try { conn = await pool.getConnection(); } catch { throw new Error('CONNESSIONE_FALLITA'); }
    let fase = 'nuovo', attiva = false, guasta = false, quarantena = false, rilasciata = false;
    let base, prima, dopo, anteprima, indice = 0;
    let pepper = randomBytes(32);
    async function esegui(sql, parametri = []) {
        try {
            if (sql === SQL.baseline) {
                richiedi(parametri.length === 0, 'START_CON_PARAMETRI');
                return await conn.query(SQL.baseline);
            }
            return await conn.execute(sql, parametri);
        }
        catch { guasta = true; throw new Error('MYSQL_OPERAZIONE_FALLITA'); }
    }
    async function rollback() {
        guasta = true;
        if (!attiva) return;
        try { await conn.rollback(); }
        catch { quarantena = true; throw new Error('ROLLBACK_FALLITO'); }
        finally { attiva = false; fase = 'fallito'; }
    }
    async function chiudi() {
        if (rilasciata) return;
        try { if (attiva) await rollback(); }
        finally {
            rilasciata = true; fase = 'chiuso'; pepper.fill(0); pepper = undefined;
            // Mai restituire al pool una connessione con esito transazionale incerto.
            if (quarantena) conn.destroy(); else conn.release();
            base = prima = dopo = undefined;
        }
    }
    async function metadati() {
        const m = {};
        for (const k of ['tabelle', 'colonne', 'pk', 'fk', 'trigger']) {
            [m[k]] = await esegui(SQL[k], k === 'fk' ? ['waveset_test', 'waveset_test'] : ['waveset_test']);
        }
        verificaMetadati(m);
    }
    async function snapshot(blocca) {
        const s = {};
        for (const t of tabelle) {
            [s[t]] = await esegui(snapshotSQL(t, blocca), [pepper]);
            richiedi(Array.isArray(s[t]), 'SNAPSHOT_FORMA');
            for (const r of s[t]) {
                richiedi(uguale(Object.keys(r).sort(), [...campi(t), 'impronta'].sort()), 'SNAPSHOT_CAMPI');
                richiedi(typeof r.impronta === 'string' && /^[a-f0-9]{64}$/.test(r.impronta), 'SNAPSHOT_IMPRONTA');
                richiedi(SCHEMA[t].pk.every(c => Number.isSafeInteger(r[c]) && r[c] > 0), 'SNAPSHOT_PK');
                richiedi(Object.keys(SCHEMA[t].fk).every(c => (t === 'brano' && c === 'album_id' && r[c] === null) || (Number.isSafeInteger(r[c]) && r[c] > 0)), 'SNAPSHOT_FK');
            }
            richiedi(new Set(s[t].map(r => chiave(t, SCHEMA[t].pk.map(c => r[c])))).size === s[t].length, 'SNAPSHOT_DUPLICATO');
        }
        return copia(s);
    }
    function stato(ammessa) { richiedi(!guasta && ammessa.includes(fase), 'TRANSIZIONE_NON_AMMESSA'); }
    async function acquisisciBaseline() {
        stato(['nuovo']); fase = 'baseline';
        try {
            await esegui(SQL.ripetibile); attiva = true;
            await esegui(SQL.baseline);
            base = await snapshot(false); await metadati();
            try { await conn.commit(); }
            catch { quarantena = true; throw new Error('COMMIT_BASELINE_INCERTO'); }
            attiva = false; fase = 'pronto'; return copia(base);
        } catch {
            guasta = true;
            try { await rollback(); } finally { /* chiudi resta obbligatorio al chiamante */ }
            throw new Error('BASELINE_FALLITA');
        }
    }
    async function beginTransaction() {
        stato(['pronto']); fase = 'inizio';
        try {
            await esegui(SQL.serializzabile); attiva = true;
            await conn.beginTransaction(); fase = 'transazione'; indice = 0; anteprima = undefined;
        } catch { await rollback(); throw new Error('INIZIO_FALLITO'); }
    }
    async function leggiStato(select) {
        stato(['transazione', 'anteprima', 'delete']);
        richiedi(uguale(select, selezioni), 'SELECT_CONTRATTO');
        const primaLettura = fase === 'transazione';
        if (!primaLettura) richiedi(indice === anteprima.righe.length, 'PIANO_INCOMPLETO');
        fase = 'lettura';
        const s = await snapshot(true); await metadati();
        if (primaLettura) { prima = s; fase = 'prima'; }
        else { dopo = s; fase = 'dopo'; }
        return copia(s);
    }
    async function salvaAnteprima(p) {
        stato(['prima']);
        richiedi(p && uguale(Object.keys(p).sort(), ['conteggi', 'righe']) && Array.isArray(p.righe), 'ANTEPRIMA_FORMA');
        const viste = new Set(); let ordine = -1;
        for (const r of p.righe) {
            richiedi(r && uguale(Object.keys(r).sort(), ['pk', 'tabella']) && SCHEMA[r.tabella] && Array.isArray(r.pk), 'ANTEPRIMA_RIGA');
            richiedi(r.pk.length === SCHEMA[r.tabella].pk.length && r.pk.every(id => Number.isSafeInteger(id) && id > 0), 'ANTEPRIMA_PK');
            const k = chiave(r.tabella, r.pk), posizione = ORDINE.indexOf(r.tabella);
            richiedi(!viste.has(k) && posizione >= ordine, 'ANTEPRIMA_DUPLICATI_ORDINE'); viste.add(k); ordine = posizione;
            const coincide = x => uguale(SCHEMA[r.tabella].pk.map(c => x[c]), r.pk);
            richiedi(!base[r.tabella].some(coincide) && prima[r.tabella].some(coincide), 'ANTEPRIMA_PK_NON_CANCELLABILE');
        }
        richiedi(uguale(p.conteggi, Object.fromEntries(ORDINE.map(t => [t, p.righe.filter(r => r.tabella === t).length]))), 'ANTEPRIMA_CONTEGGI');
        anteprima = copia(p); fase = 'anteprima';
    }
    async function query(sql, parametri) {
        stato(['anteprima', 'delete']);
        const r = anteprima.righe[indice];
        richiedi(r && sql === deletes[r.tabella] && uguale(parametri, r.pk), 'DELETE_NON_AUTORIZZATA');
        fase = 'scrittura'; const result = await esegui(sql, parametri);
        richiedi(result[0].affectedRows === 1, 'DELETE_CONTEGGIO');
        indice++; fase = 'delete'; return result;
    }
    async function commit() {
        stato(['dopo']);
        const eliminate = new Set(anteprima.righe.map(r => chiave(r.tabella, r.pk)));
        richiedi(uguale(normalizza(dopo), normalizza(prima).filter(([k]) => !eliminate.has(k))), 'STATO_PRIMA_COMMIT');
        fase = 'commit';
        try { await conn.commit(); attiva = false; fase = 'pronto'; }
        catch { guasta = true; quarantena = true; throw new Error('COMMIT_ESITO_INCERTO'); }
    }
    try {
        const c = conn.config;
        richiedi(c && c.host === ambiente.DB_HOST && String(c.port) === ambiente.DB_PORT &&
            c.database === 'waveset_test' && c.user === ambiente.DB_USER && c.password === ambiente.DB_PASSWORD &&
            !c.socketPath && !c.stream, 'CONNESSIONE_CONFIG_NON_TEST');
        richiedi(c.dateStrings === true && c.decimalNumbers === false && c.timezone === 'Z' &&
            c.typeCast === true && !c.rowsAsArray && !c.nestTables && !c.multipleStatements && !c.debug, 'CONNESSIONE_FORMATO');
        const [righe] = await esegui(SQL.database);
        richiedi(righe.length === 1 && righe[0].db === 'waveset_test', 'DATABASE_NON_TEST');
        await esegui(SQL.timezone); await esegui(SQL.charset);
    } catch { quarantena = true; await chiudi(); throw new Error('APERTURA_FALLITA'); }
    return { acquisisciBaseline, beginTransaction, leggiStato, salvaAnteprima, query,
        commit, rollback, chiudi, leggiAnteprima: () => copia(anteprima) };
}
module.exports = { creaAdapterMysqlRegistro, SQL, snapshotSQL, codificaSQL, serializzazioneSQL,
    verificaMetadati, normalizza, COLONNE, ORDINE, selezioni, deletes };
