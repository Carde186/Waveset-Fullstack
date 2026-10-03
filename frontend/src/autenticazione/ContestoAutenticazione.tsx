import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    accedi as accediApi,
    esci as esciApi,
    esciDaTutti as esciDaTuttiApi,
    recuperaSessione,
} from '../api/autenticazione';
import { ErroreApi } from '../api/client';
import { messaggioGenerico } from '../api/messaggi';
import type { Utente } from '../api/tipi';
import { ContestoAutenticazione, type StatoSessione } from './contesto';

// Stato della sessione del browser.
//   caricamento  controllo iniziale con GET /api/auth/io (dopo ogni ricarico)
//   anonimo      nessuna sessione (401); `scaduta` = c'era e non vale più
//   autenticato  sessione valida
//   errore       il backend non ha risposto al controllo: né «dentro» né «fuori»
// Il token CSRF non sta qui: vive in memoria nel client HTTP (api/client.ts).
export function ProviderAutenticazione({ children }: { children: ReactNode }) {
    const [stato, impostaStato] = useState<StatoSessione>({ tipo: 'caricamento' });
    // Numero dell'ultimo controllo avviato: un esito arrivato dopo un controllo più
    // recente (o dopo un login) non deve scrivere nello stato.
    const generazione = useRef(0);

    // Chiede la sessione al backend e ne applica l'esito, se è ancora quello valido.
    const applicaEsito = useCallback(async (aggiornato: () => boolean) => {
        try {
            const { utente } = await recuperaSessione();

            if (aggiornato()) {
                impostaStato({ tipo: 'autenticato', utente });
            }
        } catch (errore) {
            if (!aggiornato()) {
                return;
            }
            if (errore instanceof ErroreApi && errore.stato === 401) {
                impostaStato({ tipo: 'anonimo', scaduta: false });
            } else {
                impostaStato({ tipo: 'errore', messaggio: messaggioGenerico(errore) });
            }
        }
    }, []);

    useEffect(() => {
        let attivo = true;
        const numero = ++generazione.current;

        void applicaEsito(() => attivo && numero === generazione.current);

        return () => {
            attivo = false;
        };
    }, [applicaEsito]);

    // «Riprova» dopo un errore: ripete il controllo mostrando il caricamento.
    const riprova = useCallback(async () => {
        const numero = ++generazione.current;

        impostaStato({ tipo: 'caricamento' });
        await applicaEsito(() => numero === generazione.current);
    }, [applicaEsito]);

    const accedi = useCallback(async (email: string, password: string): Promise<Utente> => {
        const { utente } = await accediApi(email, password);

        generazione.current++;
        impostaStato({ tipo: 'autenticato', utente });
        return utente;
    }, []);

    // Con 401 la sessione non c'era più: si esce comunque, segnalando che era scaduta.
    const chiudi = useCallback(async (operazione: () => Promise<void>) => {
        try {
            await operazione();
            generazione.current++;
            impostaStato({ tipo: 'anonimo', scaduta: false });
        } catch (errore) {
            if (errore instanceof ErroreApi && errore.stato === 401) {
                generazione.current++;
                impostaStato({ tipo: 'anonimo', scaduta: true });
                return;
            }
            throw errore;
        }
    }, []);

    const esci = useCallback(() => chiudi(esciApi), [chiudi]);
    const esciDaTutti = useCallback(() => chiudi(esciDaTuttiApi), [chiudi]);

    const aggiornaUtente = useCallback((utente: Utente) => {
        generazione.current++;
        impostaStato(attuale => attuale.tipo === 'autenticato' && attuale.utente.id === utente.id
            ? { tipo: 'autenticato', utente } : attuale);
    }, []);

    const valore = useMemo(
        () => ({ stato, accedi, esci, esciDaTutti, riprova, aggiornaUtente }),
        [stato, accedi, esci, esciDaTutti, riprova, aggiornaUtente],
    );

    return <ContestoAutenticazione value={valore}>{children}</ContestoAutenticazione>;
}
