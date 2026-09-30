// Guardie dell'ambiente di test, caricate da aiuto.js (quindi da ogni file di
// test che usa il DB o l'HTTP). Nessuna chiamata di rete: la verifica del
// server è la canarina in aiuto.js.
const DB_TEST = 'waveset_test';
const PORTE_APP_LOCALI = ['3096', '3097', '3098', '3099'];

function imposta(nome, valore) {
    const attuale = process.env[nome];

    if (attuale !== undefined && attuale !== valore) {
        throw new Error(
            `${nome}=${attuale} in conflitto con l'ambiente di test (atteso ${valore}). ` +
                'Esegui npm test da backend/ con ../.env.test (vedi README).',
        );
    }
    process.env[nome] = valore;
}

const portaMysql = process.env.MYSQL_HOST_PORT;

if (!/^\d+$/.test(portaMysql ?? '')) {
    throw new Error('MYSQL_HOST_PORT mancante: carica ../.env.test (npm test)');
}
for (const nome of ['DB_USER', 'DB_PASSWORD', 'BACKEND_HOST_PORT']) {
    if (!process.env[nome]) {
        throw new Error(`${nome} mancante in .env.test`);
    }
}

// Il client di test vede il DB dall'host (127.0.0.1:porta pubblicata), mai
// come "mysql:3306": quello vale solo per il backend dentro Compose.
imposta('DB_HOST', '127.0.0.1');
imposta('DB_PORT', portaMysql);
imposta('DB_NAME', DB_TEST);

function verificaUrlAmmesso(url) {
    const { hostname, port } = new URL(url);
    const ammesse = [process.env.BACKEND_HOST_PORT, ...PORTE_APP_LOCALI];

    if (
        !['localhost', '127.0.0.1'].includes(hostname) ||
        !ammesse.includes(port)
    ) {
        throw new Error(`URL_API_TEST non ammesso per i test: ${url}`);
    }
}

module.exports = { DB_TEST, verificaUrlAmmesso };
