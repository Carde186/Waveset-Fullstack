import { Link } from 'react-router';
import type { Evento } from '../api/eventi';
import { dataCatalogo } from '../catalogo/formato';
import stile from './Eventi.module.css';

export function InformazioniEvento({ evento }: { evento: Evento }) {
    return <>
        <p><time dateTime={evento.dataEvento}>{dataCatalogo(evento.dataEvento)}</time> · {evento.oraEvento?.slice(0, 5) ?? 'Orario non disponibile'}</p>
        <p>{[evento.luogo, evento.citta].filter(Boolean).join(' · ') || 'Luogo non disponibile'}</p>
    </>;
}

export function LineupEvento({ evento }: { evento: Evento }) {
    return evento.lineup.length ? <ul className={stile.lineup} aria-label={`Lineup di ${evento.titolo}`}>
        {evento.lineup.map((a) => <li key={a.id}><Link to={`/artisti/${a.id}`}>{a.nome} ↗</Link></li>)}
    </ul> : <p>Lineup non disponibile.</p>;
}
