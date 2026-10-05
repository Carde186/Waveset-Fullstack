import { t } from '../localizzazione/lingua';
import { useCallback, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { idEventoDaPercorso, leggiEvento } from '../api/eventi';
import { ErroreApi } from '../api/client';
import { erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { InformazioniEvento, LineupEvento } from '../eventi/InformazioniEvento';
import { MappaEventi } from '../eventi/MappaEventi';
import { CopertinaEvento } from '../eventi/CopertinaEvento';
import { ritornoEventi } from '../eventi/filtro';
import stile from '../eventi/Eventi.module.css';

const nessunaSelezione = () => {};
export function DettaglioEvento() {
    const { id: parametro } = useParams();
    const [parametri] = useSearchParams();
    const ritorno = ritornoEventi(parametri);
    const id = idEventoDaPercorso(parametro);
    const carica = useCallback(() => id === null ? Promise.reject(new ErroreApi(400)) : leggiEvento(id), [id]);
    const { stato, riprova } = useRisorsa(`evento:${parametro}`, carica);
    const eventiMappa = useMemo(() => stato.tipo === 'pronto' ? [stato.dati] : [], [stato]);
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo={t('text.loadingEventDetails')} />;
    if (stato.tipo === 'errore') {
        if (stato.causa instanceof ErroreApi && (stato.causa.stato === 400 || stato.causa.stato === 404)) return <StatoVuoto
            occhiello={id === null ? t('events.invalidAddress') : '404'} titolo={t('text.eventNotFound')} messaggio={t('text.thisEventIsUnavailable')}
            azione={{ testo: t('events.return'), verso: ritorno }} />;
        return <StatoErrore titolo={t('text.eventDetailsAreUnavailable')} messaggio={stato.causa instanceof ErroreApi && stato.causa.stato === 401
            ? <>{t('text.yourSessionIsInvalid')}{' '}<Link to="/accedi">{t('text.logIn')}</Link> {t('text.andTryAgain')}</> : erroreCatalogo(stato.causa)} suRiprova={riprova} />;
    }
    const evento = stato.dati;
    return <section className="pagina">
        <nav aria-label={t('text.eventsBreadcrumb')} className={stile.percorso}><Link to={ritorno}>{t('text.events2')}</Link></nav>
        <Vetrina visuale={<CopertinaEvento evento={evento} hero />} visualeEstesa><div className="occhiello">{t('text.eventLocalCatalog')}</div><h1 className="titolo">{evento.titolo}</h1><InformazioniEvento evento={evento} /></Vetrina>
        <div className={stile.disposizione}>
            <MappaEventi eventi={eventiMappa} selezionato={evento.id} suSelezione={nessunaSelezione} />
            <section className={stile.carta}><h2>{t('text.lineup')}</h2><LineupEvento evento={evento} />
                {!evento.coordinate ? <p>{t('text.mapLocationUnavailable')}</p> : null}
            </section>
        </div>
    </section>;
}
