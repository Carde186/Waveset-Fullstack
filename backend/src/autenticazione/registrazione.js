// Validazione della registrazione (funzione pura, nessun accesso al DB).
//
// Il corpo ammette ESATTAMENTE tre campi: nome, email, password. Qualsiasi
// altro campo (id, ruolo, role, ...) è un 400: il ruolo lo decide solo il
// server e il client non deve poterlo nemmeno proporre.

const CAMPI_AMMESSI = ['nome', 'email', 'password'];

const NOME_MAX = 200; // VARCHAR(200)
const EMAIL_MAX = 255; // VARCHAR(255)
const PASSWORD_MIN_CARATTERI = 12;
// bcrypt considera solo i primi 72 byte: oltre si rifiuta, non si tronca.
const PASSWORD_MAX_BYTE = 72;

// Il dominio dei test (utenti test-a, test-b, test-admin nel DB di test) e i
// suoi sottodomini non si registrano: nessun utente reale può prendere
// un'identità di test.
const DOMINIO_RISERVATO = 'waveset.test';

const CARATTERI_DI_CONTROLLO = /[\u0000-\u001f\u007f-\u009f]/;
const FORMA_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function eOggettoSemplice(valore) {
    return (
        valore !== null &&
        typeof valore === 'object' &&
        !Array.isArray(valore) &&
        Object.getPrototypeOf(valore) === Object.prototype
    );
}

function lunghezzaInCaratteri(testo) {
    // Punti di codice Unicode, non unità UTF-16 (un'emoji vale 1).
    return [...testo].length;
}

function validaNome(valore, campi) {
    if (typeof valore !== 'string') {
        campi.nome = 'obbligatorio (testo)';
        return null;
    }

    const nome = valore.trim();

    if (nome === '') {
        campi.nome = 'obbligatorio';
    } else if (lunghezzaInCaratteri(nome) > NOME_MAX) {
        campi.nome = `al massimo ${NOME_MAX} caratteri`;
    } else if (CARATTERI_DI_CONTROLLO.test(nome)) {
        campi.nome = 'caratteri non ammessi';
    } else {
        return nome;
    }

    return null;
}

function validaEmail(valore, campi) {
    if (typeof valore !== 'string') {
        campi.email = 'obbligatoria (testo)';
        return null;
    }

    const email = valore.trim().toLowerCase();

    if (email === '') {
        campi.email = 'obbligatoria';
        return null;
    }
    if (lunghezzaInCaratteri(email) > EMAIL_MAX) {
        campi.email = `al massimo ${EMAIL_MAX} caratteri`;
        return null;
    }
    if (CARATTERI_DI_CONTROLLO.test(email) || !FORMA_EMAIL.test(email)) {
        campi.email = 'formato non valido';
        return null;
    }

    const dominio = email.slice(email.indexOf('@') + 1);

    if (
        dominio === DOMINIO_RISERVATO ||
        dominio.endsWith(`.${DOMINIO_RISERVATO}`)
    ) {
        campi.email = 'dominio riservato';
        return null;
    }

    return email;
}

// La password non si modifica in nessun modo (niente trim): quello che l'utente
// digita è quello che si hasha.
function validaPassword(valore, campi) {
    if (typeof valore !== 'string') {
        campi.password = 'obbligatoria (testo)';
        return null;
    }

    if (valore.includes('\u0000')) {
        campi.password = 'caratteri non ammessi';
    } else if (valore.trim() === '') {
        campi.password = 'non può essere vuota';
    } else if (lunghezzaInCaratteri(valore) < PASSWORD_MIN_CARATTERI) {
        campi.password = `almeno ${PASSWORD_MIN_CARATTERI} caratteri`;
    } else if (Buffer.byteLength(valore, 'utf8') > PASSWORD_MAX_BYTE) {
        campi.password = `al massimo ${PASSWORD_MAX_BYTE} byte`;
    } else {
        return valore;
    }

    return null;
}

// Ritorna { ok: true, dati: { nome, email, password } } oppure
// { ok: false, campi: { <campo>: <motivo> } }. I motivi non contengono mai
// valori inviati dal client (nemmeno i nomi dei campi non ammessi).
function validaRegistrazione(corpo) {
    if (!eOggettoSemplice(corpo)) {
        return { ok: false, campi: { corpo: 'corpo JSON obbligatorio' } };
    }

    const campi = {};

    if (Object.keys(corpo).some(chiave => !CAMPI_AMMESSI.includes(chiave))) {
        campi.corpo = 'sono ammessi solo nome, email e password';
    }

    const nome = validaNome(corpo.nome, campi);
    const email = validaEmail(corpo.email, campi);
    const password = validaPassword(corpo.password, campi);

    if (Object.keys(campi).length > 0) {
        return { ok: false, campi };
    }

    return { ok: true, dati: { nome, email, password } };
}

module.exports = {
    validaRegistrazione,
    validaEmail,
    validaPassword,
    DOMINIO_RISERVATO,
    PASSWORD_MIN_CARATTERI,
    PASSWORD_MAX_BYTE,
};
