import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
import stile from '../eventi/Eventi.module.css';

function Elenco({ eventi }: { eventi: Evento[] }) {
    const [scelta, impostaScelta] = useState<number | null>(null);
    const selezionato = eventi.some((e) => e.id === scelta) ? scelta : null;
    const selezionaDaMappa = useCallback((id: number) => {
        impostaScelta(id);
        const elemento = document.getElementById(`evento-${id}`);
        elemento?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        elemento?.focus({ preventScroll: true });
    }, []);
    const selezionaDaLista = useCallback((id: number) => impostaScelta(id), []);
    const attuale = eventi.find((e) => e.id === selezionato);
    return <>
        <p role="status" aria-live="polite">{eventi.length} {eventi.length === 1 ? 'evento' : 'eventi'}{attuale ? ` · Selezionato: ${attuale.titolo}` : ''}</p>
        <div className={stile.disposizione}>
            <MappaEventi eventi={eventi} selezionato={selezionato} suSelezione={selezionaDaMappa} />
            <section aria-label="Elenco degli eventi">
                <h2>Prossimi eventi</h2>
                <ul className={stile.lista}>{eventi.map((e) => <li key={e.id}>
                    <article id={`evento-${e.id}`} tabIndex={-1} className={`${stile.carta} ${selezionato === e.id ? stile.selezionata : ''}`} aria-label={e.titolo}>
                        <h3><Link to={`/eventi/${e.id}`}>{e.titolo} ↗</Link></h3>
                        <InformazioniEvento evento={e} />
                        <LineupEvento evento={e} />
                        {e.coordinate ? <Bottone variante="contorno" aria-pressed={selezionato === e.id} onClick={() => selezionaDaLista(e.id)}>Mostra sulla mappa: {e.titolo}</Bottone>
                            : <p>Posizione sulla mappa non disponibile.</p>}
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
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo="Carico gli eventi…" livelloTitolo={2} />;
    if (stato.tipo === 'errore') {
        if (stato.causa instanceof ErroreApi && stato.causa.stato === 401) return <StatoErrore
            titolo="La sessione non è più valida."
            messaggio={<><Bottone onClick={() => void ricontrollaSessione()}>Verifica la sessione</Bottone> per accedere di nuovo, oppure scegli Tutti.</>}
            suRiprova={riprova} livelloTitolo={2} />;
        return <StatoErrore titolo="Gli eventi non sono disponibili." messaggio={erroreCatalogo(stato.causa)} suRiprova={riprova} livelloTitolo={2} />;
    }
    if (!stato.dati.length) return <StatoVuoto occhiello="Eventi" titolo="Nessun evento in arrivo."
        messaggio={filtro === 'seguiti' ? 'Non ci sono eventi per gli artisti che segui. Prova il filtro Tutti.' : 'Non ci sono eventi pubblicati in arrivo.'} livelloTitolo={2} />;
    return <Elenco eventi={stato.dati} />;
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
        <Vetrina><div className="occhiello">Eventi · Catalogo locale</div><h1 className="titolo">Ci vediamo sotto cassa.</h1><p>Scopri i prossimi live e gli artisti in lineup.</p></Vetrina>
        <div className={stile.filtri} role="group" aria-label="Filtra eventi">
            <Bottone variante={filtro === 'tutti' ? 'primario' : 'contorno'} aria-pressed={filtro === 'tutti'} onClick={() => cambia('tutti')}>Tutti</Bottone>
            {stato.tipo === 'autenticato' || filtro === 'seguiti' ? <Bottone variante={filtro === 'seguiti' ? 'primario' : 'contorno'} aria-pressed={filtro === 'seguiti'} onClick={() => cambia('seguiti')}>Artisti che seguo</Bottone> : null}
        </div>
        {!valido ? <StatoErrore titolo="Filtro non valido." messaggio="Scegli Tutti oppure Artisti che seguo." livelloTitolo={2} />
            : filtro === 'seguiti' && stato.tipo === 'caricamento' ? <StatoCaricamento testo="Controllo la sessione…" livelloTitolo={2} />
            : filtro === 'seguiti' && stato.tipo === 'errore' ? <StatoErrore titolo="Non posso verificare la sessione." messaggio={stato.messaggio} suRiprova={() => void riprova()} livelloTitolo={2} />
            : filtro === 'seguiti' && stato.tipo === 'anonimo' ? <StatoVuoto occhiello="Accesso richiesto" titolo="Gli eventi dei tuoi artisti."
                messaggio="Accedi per consultare gli eventi degli artisti che segui, oppure scegli Tutti." azione={{ testo: 'Accedi', verso: '/accedi' }} livelloTitolo={2} />
            : <EventiCaricati filtro={filtro as FiltroEventi} utente={stato.tipo === 'autenticato' ? stato.utente.id : null} />}
    </section>;
}
