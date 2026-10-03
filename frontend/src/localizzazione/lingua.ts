import { useSyncExternalStore } from 'react';
import it from './it.json';
import en from './en.json';

export type Lingua = 'it' | 'en';
export type Chiave = keyof typeof it;
export const STORAGE_LINGUA = 'waveset.lingua';
let senzaStorage: Lingua = 'it';
let soloMemoria = false;
const ascoltatori = new Set<() => void>();

export function leggiLingua(): Lingua {
    if (soloMemoria) return senzaStorage;
    try {
        return localStorage.getItem(STORAGE_LINGUA) === 'en' ? 'en' : 'it';
    } catch {
        return senzaStorage;
    }
}
export function impostaLingua(lingua: Lingua) {
    senzaStorage = lingua;
    try {
        localStorage.setItem(STORAGE_LINGUA, lingua);
        soloMemoria = false;
    } catch {
        soloMemoria = true;
    }
    document.documentElement.lang = lingua;
    for (const avvisa of ascoltatori) avvisa();
}
function ascolta(avvisa: () => void) {
    ascoltatori.add(avvisa);
    window.addEventListener('storage', avvisa);
    return () => {
        ascoltatori.delete(avvisa);
        window.removeEventListener('storage', avvisa);
    };
}
export function useLingua(): Lingua {
    return useSyncExternalStore(ascolta, leggiLingua, () => 'it');
}
export function t(chiave: Chiave, parametri: Record<string, string | number> = {}): string {
    const dizionario: Record<Chiave, string> = leggiLingua() === 'en' ? en : it;
    return dizionario[chiave].replace(/\{(\w+)\}/g, (token, nome: string) =>
        Object.hasOwn(parametri, nome) ? String(parametri[nome]) : token,
    );
}
export function locale(): string {
    return leggiLingua() === 'en' ? 'en-GB' : 'it-IT';
}
