import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Evento } from '../api/eventi';
import { Bottone } from '../componenti/Bottone';
import { ascoltaErroreGoogle, caricaMaps, creaMappa, leggiModalita, MODALITA_MAPPA, salvaModalita, type LibrerieMaps, type ModalitaMappa } from './maps';
import stile from './Eventi.module.css';

const NOMI: Record<ModalitaMappa, string> = {
    standard: 'Standard', scura: 'Scura', satellite: 'Satellite', ibrida: 'Ibrida',
};
type StatoMappa = { tipo: 'caricamento' | 'pronto' } | { tipo: 'errore'; messaggio: string };

export function MappaEventi({ eventi, selezionato, suSelezione }: {
    eventi: Evento[]; selezionato: number | null; suSelezione: (id: number) => void;
}) {
    const contenitore = useRef<HTMLDivElement>(null);
    const controllo = useRef<ReturnType<typeof creaMappa> | null>(null);
    const [modalita, impostaModalita] = useState(leggiModalita);
    const [tentativo, impostaTentativo] = useState(0);
    const [esito, impostaEsito] = useState<{ eventi: Evento[]; tentativo: number; stato: StatoMappa } | null>(null);
    const chiave = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
    const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID?.trim();
    const configurata = Boolean(chiave && mapId);
    const conCoordinate = eventi.some((e) => e.coordinate !== null);
    const stato: StatoMappa = esito?.eventi === eventi && esito.tentativo === tentativo ? esito.stato : { tipo: 'caricamento' };

    // Legge modalità e selezione più recenti anche se il loader era in viaggio.
    const inizializza = useEffectEvent((api: LibrerieMaps, pronto: () => void, errore: (messaggio: string) => void) =>
        creaMappa({ contenitore: contenitore.current!, api, mapId: mapId!, eventi, modalita, selezionato, suSelezione, suPronto: pronto, suErrore: errore }),
    );

    useEffect(() => {
        if (!chiave || !mapId || !conCoordinate) return;
        let attivo = true;
        let locale: ReturnType<typeof creaMappa> | null = null;
        const fallisci = (messaggio: string) => {
            if (!attivo) return;
            locale?.distruggi();
            controllo.current = null;
            impostaEsito({ eventi, tentativo, stato: { tipo: 'errore', messaggio } });
        };
        let authFallita = false;
        const annullaAuth = ascoltaErroreGoogle(() => {
            authFallita = true;
            fallisci('Google Maps non ha autorizzato la mappa. Gli eventi restano consultabili nella lista.');
        });
        if (!authFallita) void caricaMaps(chiave).then((api) => {
            if (!attivo || authFallita) return;
            try {
                locale = inizializza(api, () => {
                    if (attivo && !authFallita) impostaEsito({ eventi, tentativo, stato: { tipo: 'pronto' } });
                }, fallisci);
                controllo.current = locale;
            } catch { fallisci('Non è possibile inizializzare Google Maps. Riprova.'); }
        }, (errore: unknown) => {
            if (!authFallita) fallisci(errore instanceof Error && errore.message.includes('in tempo')
                ? 'Google Maps non risponde in tempo. Riprova.'
                : 'Non è possibile caricare Google Maps. Riprova.');
        });
        return () => {
            attivo = false;
            annullaAuth();
            locale?.distruggi();
            controllo.current = null;
        };
    }, [eventi, tentativo, chiave, mapId, conCoordinate]);

    useEffect(() => {
        controllo.current?.modalita(modalita);
    }, [modalita, eventi, tentativo]);
    useEffect(() => { controllo.current?.seleziona(selezionato); }, [selezionato]);

    function cambia(m: ModalitaMappa) {
        impostaModalita(m);
        salvaModalita(m);
    }

    return <section className={stile.pannelloMappa} aria-label="Mappa degli eventi">
        <h2>Trova il tuo prossimo live</h2>
        <label className={stile.selettore}>Modalità mappa
            <select value={modalita} onChange={(e) => cambia(e.target.value as ModalitaMappa)}>
                {MODALITA_MAPPA.map((m) => <option value={m} key={m}>{NOMI[m]}</option>)}
            </select>
        </label>
        {!configurata ? <p role="status">La mappa non è configurata. Puoi consultare tutti gli eventi nella lista.</p>
            : !conCoordinate ? <p role="status">Nessun evento ha coordinate disponibili. Puoi consultare gli eventi nella lista.</p>
            : <>
                {stato.tipo === 'caricamento' ? <p role="status">Carico Google Maps…</p> : null}
                {stato.tipo === 'errore' ? <div role="alert">
                    <p>{stato.messaggio}</p>
                    <Bottone onClick={() => impostaTentativo((n) => n + 1)}>Riprova mappa</Bottone>
                </div> : null}
                <div ref={contenitore} className={stile.mappa} hidden={stato.tipo === 'errore'} aria-label="Google Maps: usa le frecce per spostarti; gli eventi sono disponibili anche nella lista" />
            </>}
    </section>;
}
