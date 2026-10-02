// Forme delle risposte del backend, così come sono oggi (vedi README della radice,
// sezioni «Sessione per il browser» e «Registrazione»). Nessuna forma inventata.

export type Ruolo = 'USER' | 'ADMIN';

export interface Utente {
    id: number;
    nome: string;
    email: string;
    ruolo: Ruolo;
}

// POST /api/auth/web/login e GET /api/auth/io (con il cookie di sessione).
export interface RispostaSessione {
    utente: Utente;
    csrf: string;
}

// POST /api/auth/registrazione (201).
export interface RispostaRegistrazione {
    utente: Utente;
}

export interface DatiRegistrazione {
    nome: string;
    email: string;
    password: string;
}

export type CampoRegistrazione = 'nome' | 'email' | 'password';
