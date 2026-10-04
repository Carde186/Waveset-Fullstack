import { testoMessaggio } from '../api/messaggi';
import { t } from '../localizzazione/lingua';
import { CopertinaEvento } from '../eventi/CopertinaEvento';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { elencaEventi, type Evento, type FiltroEventi } from '../api/eventi';
import { ErroreApi } from '../api/client';
import { useAutenticazione } from '../autenticazione/contesto';
import { erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Bottone } from '../componenti/Bottone';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { InformazioniEvento, LineupEvento } from '../eventi/InformazioniEvento';
import { MappaEventi } from '../eventi/MappaEventi';
import { AggiornamentoEventi } from '../eventi/AggiornamentoEventi';
import stile from '../eventi/Eventi.module.css';

function Elenco({ eventi, filtro }: { eventi: Evento[]; filtro: FiltroEventi }) {
    const naviga = useNavigate();
    const [scelta, impostaScelta] = useState<number | null>(null);
    const selezionato = eventi.some((e) => e.id === scelta) ? scelta : null;
    const selezionaDaMappa = useCallback((id: number) => {
        impostaScelta(id);
        const elemento = document.getElementById(`evento-${id}`);
        elemento?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        elemento?.focus({ preventScroll: true });
        void naviga(`/eventi/${id}?filtro=${filtro}`);
    }, [filtro, naviga]);
    const selezionaDaLista = useCallback((id: number) => impostaScelta(id), []);
    const attuale = eventi.find((e) => e.id === selezionato);
    return <>
        <p role="status" aria-live="polite">{t(eventi.length === 1 ? 'events.countOne' : 'events.countMany', { count: eventi.length })}{attuale ? t('events.selected', { name: attuale.titolo }) : ''}</p>
        <div className={stile.disposizione}>
            <MappaEventi eventi={eventi} selezionato={selezionato} suSelezione={selezionaDaMappa} />
            <section aria-label={t('text.eventList')}>
                <h2>{t('text.upcomingEvents')}</h2>
                <ul className={stile.lista}>{eventi.map((e) => <li key={e.id}>
                    <article id={`evento-${e.id}`} tabIndex={-1} className={`${stile.carta} ${selezionato === e.id ? stile.selezionata : ''}`} aria-label={e.titolo}>
                        <CopertinaEvento evento={e} />
                        <h3><Link to={`/eventi/${e.id}?filtro=${filtro}`}>{e.titolo} ↗</Link></h3>
                        <InformazioniEvento evento={e} />
                        <LineupEvento evento={e} />
                        {e.coordinate ? <Bottone variante="contorno" aria-pressed={selezionato === e.id} onClick={() => selezionaDaLista(e.id)}>{t('text.showOnMap')}{' '}{e.titolo}</Bottone>
                            : <p>{t('text.mapLocationUnavailable')}</p>}
                    </article>
                </li>)}</ul>
            </section>
        </div>
    </>;
}

function EventiCaricati({ filtro, utente }: { filtro: FiltroEventi; utente: number | null }) {
    const { riprova: ricontrollaSessione } = useAutenticazione();
    const carica = useCallback(() => elencaEventi(filtro), [filtro]);
    const { stato, riprova } = useRisorsa(`eventi:${filtro}:${filtro === 'seguiti' ? utente : 'pubblico'}`, carica);
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo={t('text.loadingEvents')} livelloTitolo={2} />;
    if (stato.tipo === 'errore') {
        if (stato.causa instanceof ErroreApi && stato.causa.stato === 401) return <StatoErrore
            titolo={t('text.yourSessionIsNoLongerValid2')}
            messaggio={<><Bottone onClick={() => void ricontrollaSessione()}>{t('text.checkYourSession')}</Bottone> {t('text.toLogInAgainOrSelect')}</>}
            suRiprova={riprova} livelloTitolo={2} />;
        return <StatoErrore titolo={t('text.eventsAreUnavailable')} messaggio={erroreCatalogo(stato.causa)} suRiprova={riprova} livelloTitolo={2} />;
    }
    if (!stato.dati.length) return <StatoVuoto occhiello={t('text.events')} titolo={t('text.noUpcomingEvents')}
        messaggio={filtro === 'seguiti' ? t('events.emptyFollowed') : t('events.empty')} livelloTitolo={2} />;
    return <Elenco eventi={stato.dati} filtro={filtro} />;
}

export function Eventi() {
    const [parametri, impostaParametri] = useSearchParams();
    const filtro = parametri.get('filtro') ?? 'tutti';
    const valido = (filtro === 'tutti' || filtro === 'seguiti') && parametri.getAll('filtro').length <= 1;
    const { stato, riprova } = useAutenticazione();
    function cambia(v: FiltroEventi) {
        const nuovi = new URLSearchParams(parametri);
        nuovi.set('filtro', v);
        impostaParametri(nuovi);
    }
    return <section className="pagina">
        <Vetrina><div className="occhiello">{t('text.eventsLocalCatalog')}</div><h1 className="titolo">{t('text.seeYouByTheSpeakers')}</h1><p>{t('text.discoverUpcomingLiveShowsAndArtists')}</p></Vetrina>
        {valido && (filtro === 'tutti' || stato.tipo === 'autenticato') ? <AggiornamentoEventi /> : null}
        <div className={stile.filtri} role="group" aria-label={t('text.filterEvents')}>
            <Bottone variante={filtro === 'tutti' ? 'primario' : 'contorno'} aria-pressed={filtro === 'tutti'} onClick={() => cambia('tutti')}>{t('text.all')}</Bottone>
            {stato.tipo === 'autenticato' || filtro === 'seguiti' ? <Bottone disabled={stato.tipo !== 'autenticato'} variante={filtro === 'seguiti' ? 'primario' : 'contorno'} aria-pressed={filtro === 'seguiti'} onClick={() => cambia('seguiti')}>{t('text.artistsIFollow')}</Bottone> : null}
        </div>
        {!valido ? <StatoErrore titolo={t('text.invalidFilter')} messaggio={t('text.chooseAllOrArtistsIFollow')} livelloTitolo={2} />
            : filtro === 'seguiti' && stato.tipo === 'caricamento' ? <StatoCaricamento testo={t('text.checkingYourSession')} livelloTitolo={2} />
            : filtro === 'seguiti' && stato.tipo === 'errore' ? <StatoErrore titolo={t('text.iCanTCheckYourSession')} messaggio={testoMessaggio(stato.messaggio)} suRiprova={() => void riprova()} livelloTitolo={2} />
            : filtro === 'seguiti' && stato.tipo === 'anonimo' ? <StatoVuoto occhiello={t('text.loginRequired')} titolo={t('text.eventsForYourArtists')}
                messaggio={t('text.logInToBrowseEventsFor')} azione={{ testo: t('text.logIn'), verso: '/accedi' }} livelloTitolo={2} />
            : <EventiCaricati filtro={filtro as FiltroEventi} utente={stato.tipo === 'autenticato' ? stato.utente.id : null} />}
    </section>;
}
