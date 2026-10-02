import { useEffect, useState } from 'react';

export type StatoRisorsa<T> =
    { tipo: 'caricamento' } | { tipo: 'pronto'; dati: T } | { tipo: 'errore'; causa: unknown };

// Una risposta appartiene a una chiave e a un tentativo: non viene mostrata
// durante una nuova ricerca, cambio filtro/ID, retry o dopo lo smontaggio.
export function useRisorsa<T>(chiave: string, carica: () => Promise<T>, ritardo = 0) {
    const [tentativo, impostaTentativo] = useState(0);
    const [esito, impostaEsito] = useState<{
        chiave: string;
        tentativo: number;
        carica: () => Promise<T>;
        stato: StatoRisorsa<T>;
    } | null>(null);

    useEffect(() => {
        let attivo = true;
        const timer = setTimeout(() => {
            void carica().then(
                (dati) => {
                    if (attivo)
                        impostaEsito({
                            chiave,
                            tentativo,
                            carica,
                            stato: { tipo: 'pronto', dati },
                        });
                },
                (causa) => {
                    if (attivo)
                        impostaEsito({
                            chiave,
                            tentativo,
                            carica,
                            stato: { tipo: 'errore', causa },
                        });
                },
            );
        }, ritardo);
        return () => {
            attivo = false;
            clearTimeout(timer);
        };
    }, [chiave, carica, tentativo, ritardo]);

    const stato: StatoRisorsa<T> =
        esito?.chiave === chiave && esito.tentativo === tentativo && esito.carica === carica
            ? esito.stato
            : { tipo: 'caricamento' };
    return { stato, riprova: () => impostaTentativo((n) => n + 1) };
}
