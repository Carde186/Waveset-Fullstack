import { t, useLingua, type Chiave } from '../localizzazione/lingua';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Evento } from '../api/eventi';
import { Bottone } from '../componenti/Bottone';
import { ascoltaErroreGoogle, caricaMaps, creaMappa, leggiModalita, MODALITA_MAPPA, salvaModalita, type LibrerieMaps, type ModalitaMappa } from './maps';
import stile from './Eventi.module.css';

const NOMI: Record<ModalitaMappa, Chiave> = {
    standard: 'maps.standard', scura: 'maps.dark', satellite: 'maps.satellite', ibrida: 'maps.hybrid',
};
type StatoMappa = { tipo: 'caricamento' | 'pronto' } | { tipo: 'errore'; messaggio: Chiave };

export function MappaEventi({ eventi, selezionato, suSelezione }: {
    eventi: Evento[]; selezionato: number | null; suSelezione: (id: number) => void;
}) {
    const lingua = useLingua();
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
    const inizializza = useEffectEvent((api: LibrerieMaps, pronto: () => void, errore: (messaggio: Chiave) => void) =>
        creaMappa({ contenitore: contenitore.current!, api, mapId: mapId!, eventi, modalita, selezionato, suSelezione, suPronto: pronto, suErrore: errore }),
    );

    useEffect(() => {
        if (!chiave || !mapId || !conCoordinate) return;
        let attivo = true;
        let locale: ReturnType<typeof creaMappa> | null = null;
        let authFallita = false;
        let ripetuto = false;
        let timerRetry: ReturnType<typeof setTimeout> | undefined;
        const fallisci = (messaggio: Chiave) => {
            if (!attivo) return;
            clearTimeout(timerRetry);
            locale?.distruggi();
            locale = null;
            controllo.current = null;
            // Una risposta Google temporaneamente lenta/fallita non deve
            // richiedere un click. Un solo retry, con lo stesso SDK condiviso.
            if (!authFallita && !ripetuto && messaggio === 'maps.timeout') {
                ripetuto = true;
                impostaEsito({ eventi, tentativo, stato: { tipo: 'caricamento' } });
                timerRetry = setTimeout(carica, 500);
                return;
            }
            impostaEsito({ eventi, tentativo, stato: { tipo: 'errore', messaggio } });
        };
        function carica() {
            if (!attivo || authFallita) return;
            void caricaMaps(chiave!).then((api) => {
                if (!attivo || authFallita) return;
                try {
                    locale = inizializza(api, () => {
                        if (attivo && !authFallita) impostaEsito({ eventi, tentativo, stato: { tipo: 'pronto' } });
                    }, fallisci);
                    controllo.current = locale;
                } catch { fallisci('maps.init'); }
            }, (errore: unknown) => {
                if (!authFallita) fallisci(errore instanceof Error && errore.message === 'maps.timeout'
                    ? 'maps.timeout'
                    : 'maps.load');
            });
        }
        const annullaAuth = ascoltaErroreGoogle(() => {
            authFallita = true;
            fallisci('maps.authList');
        });
        carica();
        return () => {
            attivo = false;
            clearTimeout(timerRetry);
            annullaAuth();
            locale?.distruggi();
            controllo.current = null;
        };
    }, [eventi, tentativo, chiave, mapId, conCoordinate]);

    useEffect(() => {
        controllo.current?.modalita(modalita);
    }, [modalita, eventi, tentativo]);
    useEffect(() => { controllo.current?.aggiornaTesti(); }, [lingua]);
    useEffect(() => { controllo.current?.seleziona(selezionato); }, [selezionato]);

    function cambia(m: ModalitaMappa) {
        impostaModalita(m);
        salvaModalita(m);
    }

    return <section className={stile.pannelloMappa} aria-label={t('text.eventMap')}>
        <h2>{t('text.findYourNextLiveShow')}</h2>
        <label className={stile.selettore}>{t('text.mapMode')}<select value={modalita} onChange={(e) => cambia(e.target.value as ModalitaMappa)}>
                {MODALITA_MAPPA.map((m) => <option value={m} key={m}>{t(NOMI[m])}</option>)}
            </select>
        </label>
        {!configurata ? <p role="status">{t('text.theMapIsNotConfiguredYou')}</p>
            : !conCoordinate ? <p role="status">{t('text.noEventsHaveCoordinatesAvailableYou')}</p>
            : <>
                {stato.tipo === 'caricamento' ? <p role="status">{t('text.loadingGoogleMaps')}</p> : null}
                {stato.tipo === 'errore' ? <div role="alert">
                    <p>{t(stato.messaggio)}</p>
                    <Bottone onClick={() => impostaTentativo((n) => n + 1)}>{t('text.retryMap')}</Bottone>
                </div> : null}
                <div ref={contenitore} className={stile.mappa} hidden={stato.tipo === 'errore'} aria-label={t('text.googleMapsUseTheArrowKeys')} />
            </>}
    </section>;
}
