import { createContext, useContext } from 'react';
import type { Utente } from '../api/tipi';

export type StatoSessione =
    | { tipo: 'caricamento' }
    | { tipo: 'anonimo'; scaduta: boolean }
    | { tipo: 'autenticato'; utente: Utente }
    | { tipo: 'errore'; messaggio: string };

export interface ValoreContesto {
    stato: StatoSessione;
    accedi: (email: string, password: string) => Promise<Utente>;
    esci: () => Promise<void>;
    esciDaTutti: () => Promise<void>;
    riprova: () => Promise<void>;
}

export const ContestoAutenticazione = createContext<ValoreContesto | null>(null);

export function useAutenticazione(): ValoreContesto {
    const valore = useContext(ContestoAutenticazione);

    if (valore === null) {
        throw new Error('useAutenticazione va usato dentro ProviderAutenticazione');
    }

    return valore;
}
