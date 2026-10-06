import { t } from '../localizzazione/lingua';
import { CopertinaEvento } from '../eventi/CopertinaEvento';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { elencaEventi, type Evento, type FiltroEventi } from '../api/eventi';
import { ErroreApi } from '../api/client';
import { useAutenticazione } from '../autenticazione/contesto';
import { testoMessaggio } from '../api/messaggi';
import { elencaGeneri } from '../api/catalogo';
import { leggiFiltroEventi, queryEventi } from '../eventi/filtro';
import { erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Bottone } from '../componenti/Bottone';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { InformazioniEvento, LineupEvento } from '../eventi/InformazioniEvento';
import { MappaEventi } from '../eventi/MappaEventi';
import { AggiornamentoEventi } from '../eventi/AggiornamentoEventi';
import stile from '../eventi/Eventi.module.css';

function Elenco({ eventi, genereId, filtro }: { eventi: Evento[]; genereId?: number; filtro: FiltroEventi }) {
    const naviga = useNavigate();
    const [scelta, impostaScelta] = useState<number | null>(null);
    const selezionato = eventi.some((e) => e.id === scelta) ? scelta : null;
    const selezionaDaMappa = useCallback((id: number) => {
        impostaScelta(id);
        const elemento = document.getElementById(`evento-${id}`);
        elemento?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        elemento?.focus({ preventScroll: true });
        void naviga(`/eventi/${id}${queryEventi(genereId, filtro)}`);
    }, [genereId, filtro, naviga]);
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
                        <h3><Link to={`/eventi/${e.id}${queryEventi(genereId, filtro)}`}>{e.titolo} ↗</Link></h3>
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

function EventiCaricati({ genereId, filtro, utenteId }: { genereId?: number; filtro: FiltroEventi; utenteId: number | null }) {
    const { riprova: controllaSessione } = useAutenticazione();
    const carica = useCallback(() => elencaEventi(filtro, genereId), [filtro, genereId]);
    const { stato, riprova } = useRisorsa(`eventi:${filtro}:${genereId ?? 'tutti'}:${filtro === 'seguiti' ? utenteId : 'pubblico'}`, carica);
    const contenuto = stato.tipo === 'caricamento' ? <StatoCaricamento testo={t('text.loadingEvents')} livelloTitolo={2} />
        : stato.tipo === 'errore' ? stato.causa instanceof ErroreApi && stato.causa.stato === 401
            ? <StatoErrore titolo={t('text.yourSessionIsNoLongerValid2')} messaggio={<Bottone onClick={() => void controllaSessione()}>{t('text.checkYourSession')}</Bottone>} suRiprova={riprova} livelloTitolo={2} />
            : <StatoErrore titolo={t('text.eventsAreUnavailable')} messaggio={erroreCatalogo(stato.causa)} suRiprova={riprova} livelloTitolo={2} />
        : !stato.dati.length ? <StatoVuoto occhiello={t('text.events')} titolo={t('text.noUpcomingEvents')}
            messaggio={t(filtro === 'seguiti' ? 'events.emptyFollowed' : genereId === undefined ? 'events.empty' : 'events.emptyGenre')} livelloTitolo={2} />
        : <Elenco eventi={stato.dati} genereId={genereId} filtro={filtro} />;
    return <><p><Bottone variante="contorno" disabled={stato.tipo === 'caricamento'} onClick={riprova}>{t('events.refresh')}</Bottone></p>{contenuto}</>;
}

export function Eventi() {
    const [parametri, impostaParametri] = useSearchParams();
    const { valido: queryValida, genereId, filtro } = leggiFiltroEventi(parametri);
    const { stato: generi, riprova } = useRisorsa('generi:eventi', elencaGeneri);
    const valido = queryValida && (genereId === undefined || generi.tipo !== 'pronto' || generi.dati.some(g => g.id === genereId));
    const { stato: sessione, riprova: riprovaSessione } = useAutenticazione();
    const puoSeguire = sessione.tipo === 'autenticato' && sessione.utente.ruolo === 'USER';
    function cambia(id?: number, prossimoFiltro: FiltroEventi = filtro) {
        impostaParametri(queryEventi(id, prossimoFiltro).slice(1));
    }
    return <section className="pagina">
        <Vetrina><div className="occhiello">{t('text.eventsLocalCatalog')}</div><h1 className="titolo">{t('text.seeYouByTheSpeakers')}</h1><p>{t('text.discoverUpcomingLiveShowsAndArtists')}</p></Vetrina>
        {valido && (filtro === 'tutti' || puoSeguire) ? <AggiornamentoEventi /> : null}
        <div className={stile.filtri} role="group" aria-label={t('events.filterGenres')}>
            <Bottone variante={valido && genereId === undefined && filtro === 'tutti' ? 'primario' : 'contorno'} aria-pressed={valido && genereId === undefined && filtro === 'tutti'} onClick={() => cambia(undefined, 'tutti')}>{t('text.all')}</Bottone>
            <Bottone disabled={!puoSeguire} variante={filtro === 'seguiti' ? 'primario' : 'contorno'} aria-pressed={filtro === 'seguiti'} onClick={() => cambia(genereId, filtro === 'seguiti' ? 'tutti' : 'seguiti')}>{t('follow.pageTitle')}</Bottone>
            {generi.tipo === 'pronto' ? generi.dati.map(g => <Bottone key={g.id} variante={genereId === g.id ? 'primario' : 'contorno'} aria-pressed={genereId === g.id} onClick={() => cambia(g.id)}>{g.nome}</Bottone>) : null}
        </div>
        {sessione.tipo === 'anonimo' ? <p className={stile.notaFiltro}>{t('follow.filterGuest')} <Link to="/accedi">{t('text.logIn')}</Link></p> : null}
        {generi.tipo === 'caricamento' ? <p role="status">{t('events.loadingGenres')}</p> : null}
        {generi.tipo === 'errore' ? <StatoErrore titolo={t('events.genresUnavailable')} messaggio={erroreCatalogo(generi.causa)} suRiprova={riprova} livelloTitolo={2} /> : null}
        {!valido ? <StatoErrore titolo={t('text.invalidFilter')} messaggio={t('events.chooseGenre')} livelloTitolo={2} />
            : genereId !== undefined && generi.tipo === 'caricamento' ? <StatoCaricamento testo={t('text.loadingEvents')} livelloTitolo={2} />
            : filtro === 'seguiti' && sessione.tipo === 'caricamento' ? <StatoCaricamento testo={t('text.checkingYourSession')} livelloTitolo={2} />
            : filtro === 'seguiti' && sessione.tipo === 'errore' ? <StatoErrore titolo={t('text.iCanTCheckYourSession')} messaggio={testoMessaggio(sessione.messaggio)} suRiprova={() => void riprovaSessione()} livelloTitolo={2} />
            : filtro === 'seguiti' && sessione.tipo === 'anonimo' ? <StatoVuoto occhiello={t('follow.pageTitle')} titolo={t('text.eventsForYourArtists')} messaggio={t('text.logInToBrowseEventsFor')} azione={{ testo: t('text.logIn'), verso: '/accedi' }} livelloTitolo={2} />
            : filtro === 'seguiti' && !puoSeguire ? <StatoVuoto occhiello="403" titolo={t('follow.onlyUsers')} messaggio={t('follow.onlyUsersMessage')} livelloTitolo={2} />
            : <EventiCaricati genereId={genereId} filtro={filtro} utenteId={sessione.tipo === 'autenticato' ? sessione.utente.id : null} />}
    </section>;
}
