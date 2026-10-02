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
import stile from '../eventi/Eventi.module.css';

const nessunaSelezione = () => {};
export function DettaglioEvento() {
    const { id: parametro } = useParams();
    const [parametri] = useSearchParams();
    const filtro = parametri.get('filtro');
    const ritorno = parametri.getAll('filtro').length === 1 && (filtro === 'tutti' || filtro === 'seguiti')
        ? `/eventi?filtro=${filtro}` : '/eventi';
    const id = idEventoDaPercorso(parametro);
    const carica = useCallback(() => id === null ? Promise.reject(new ErroreApi(400)) : leggiEvento(id), [id]);
    const { stato, riprova } = useRisorsa(`evento:${parametro}`, carica);
    const eventiMappa = useMemo(() => stato.tipo === 'pronto' ? [stato.dati] : [], [stato]);
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo="Carico il dettaglio evento…" />;
    if (stato.tipo === 'errore') {
        if (stato.causa instanceof ErroreApi && (stato.causa.stato === 400 || stato.causa.stato === 404)) return <StatoVuoto
            occhiello={id === null ? 'Indirizzo non valido' : '404'} titolo="Evento non trovato." messaggio="Questo evento non è disponibile."
            azione={{ testo: 'Torna agli eventi', verso: '/eventi' }} />;
        return <StatoErrore titolo="Il dettaglio evento non è disponibile." messaggio={stato.causa instanceof ErroreApi && stato.causa.stato === 401
            ? <>La sessione non è valida. <Link to="/accedi">Accedi</Link> e riprova.</> : erroreCatalogo(stato.causa)} suRiprova={riprova} />;
    }
    const evento = stato.dati;
    return <section className="pagina">
        <nav aria-label="Percorso negli eventi" className={stile.percorso}><Link to={ritorno}>← Eventi</Link></nav>
        <Vetrina><div className="occhiello">Evento · Catalogo locale</div><h1 className="titolo">{evento.titolo}</h1><InformazioniEvento evento={evento} /></Vetrina>
        <div className={stile.disposizione}>
            <MappaEventi eventi={eventiMappa} selezionato={evento.id} suSelezione={nessunaSelezione} />
            <section className={stile.carta}><h2>Lineup</h2><LineupEvento evento={evento} />
                {!evento.coordinate ? <p>Posizione sulla mappa non disponibile.</p> : null}
            </section>
        </div>
    </section>;
}
