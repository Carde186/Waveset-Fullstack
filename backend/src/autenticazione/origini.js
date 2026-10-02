// Origini ammesse per la futura sessione browser (funzioni pure, nessun I/O).
//
// Un'origine è `schema://host[:porta]`, senza percorso, query, frammento né
// credenziali. Il confronto con l'intestazione Origin è ESATTO: niente
// caratteri jolly, niente `null`, niente corrispondenze parziali (prefisso,
// suffisso, sottodomini, maiuscole diverse). I browser inviano Origin in
// minuscolo e senza porta predefinita, quindi la configurazione si riduce alla
// stessa forma canonica.

const MAX_ORIGINI = 10;
const MAX_TESTO_ERRORE = 100;

const ETICHETTA = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_DNS = `${ETICHETTA}(?:\\.${ETICHETTA})*`;
const FORMA_ORIGINE = new RegExp(
    `^(https?)://(\\[[0-9a-f:]+\\]|${HOST_DNS})(?::(\\d{1,5}))?$`,
    'i',
);

// Con http sono ammessi solo host di loopback (sviluppo locale): un'origine
// http su un host pubblico è quasi certamente un errore di configurazione.
const HOST_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const PORTA_PREDEFINITA = { http: 80, https: 443 };

function troncato(testo) {
    const s = String(testo);

    return s.length > MAX_TESTO_ERRORE ? `${s.slice(0, MAX_TESTO_ERRORE)}…` : s;
}

// Forma canonica di un'origine, oppure null se non è un'origine valida.
function normalizzaOrigine(testo) {
    if (typeof testo !== 'string' || testo.length > 300) {
        return null;
    }

    const trovato = FORMA_ORIGINE.exec(testo);

    if (!trovato) {
        return null;
    }

    const schema = trovato[1].toLowerCase();
    const host = trovato[2].toLowerCase();
    const portaTesto = trovato[3];

    if (host.length > 253) {
        return null;
    }
    if (schema === 'http' && !HOST_LOOPBACK.has(host)) {
        return null;
    }

    let porta = '';

    if (portaTesto !== undefined) {
        const numero = Number(portaTesto);

        if (numero < 1 || numero > 65535) {
            return null;
        }
        if (numero !== PORTA_PREDEFINITA[schema]) {
            porta = `:${numero}`;
        }
    }

    return `${schema}://${host}${porta}`;
}

// Legge FRONTEND_ORIGINS (elenco separato da virgole). Una voce non valida,
// vuota o di troppo invalida TUTTO l'elenco: mai una configurazione a metà.
// Ritorna { presente, origini: Set, errori: [testo] }.
function parseOrigini(valore) {
    if (valore === undefined || valore === null) {
        return { presente: false, origini: new Set(), errori: [] };
    }
    if (typeof valore !== 'string') {
        return {
            presente: true,
            origini: new Set(),
            errori: ['il valore non è un testo'],
        };
    }
    if (valore.trim() === '') {
        return { presente: false, origini: new Set(), errori: [] };
    }

    const origini = new Set();
    const errori = [];
    const voci = valore.split(',');

    if (voci.length > MAX_ORIGINI) {
        errori.push(`al massimo ${MAX_ORIGINI} origini`);
    }

    for (const voce of voci) {
        const testo = voce.trim();

        if (testo === '') {
            errori.push('voce vuota (virgola in eccesso)');
            continue;
        }

        const origine = normalizzaOrigine(testo);

        if (origine === null) {
            errori.push(`origine non valida: "${troncato(testo)}"`);
        } else {
            origini.add(origine);
        }
    }

    return {
        presente: true,
        origini: errori.length === 0 ? origini : new Set(),
        errori,
    };
}

// Confronto ESATTO fra il valore dell'intestazione Origin e le origini
// configurate: nessuna normalizzazione del valore ricevuto.
function origineAmmessa(origin, origini) {
    return (
        typeof origin === 'string' &&
        origini instanceof Set &&
        origini.has(origin)
    );
}

module.exports = {
    normalizzaOrigine,
    parseOrigini,
    origineAmmessa,
    MAX_ORIGINI,
};
