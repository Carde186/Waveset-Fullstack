import { t } from '../localizzazione/lingua';
import { Link } from 'react-router';
import type { Evento } from '../api/eventi';
import { dataCatalogo } from '../catalogo/formato';
import stile from './Eventi.module.css';

export function InformazioniEvento({ evento }: { evento: Evento }) {
    return <>
        <p><time dateTime={evento.dataEvento}>{dataCatalogo(evento.dataEvento)}</time> · {evento.oraEvento?.slice(0, 5) ?? t('catalog.timeUnavailable')}</p>
        <p>{[evento.luogo, evento.citta].filter(Boolean).join(' · ') || t('catalog.locationUnavailable')}</p>
    </>;
}

export function LineupEvento({ evento }: { evento: Evento }) {
    return evento.lineup.length ? <ul className={stile.lineup} aria-label={t('events.lineup', { name: evento.titolo })}>
        {evento.lineup.map((a) => <li key={a.id}><Link to={`/artisti/${a.id}`}>{a.nome} ↗</Link></li>)}
    </ul> : <p>{t('text.lineupUnavailable')}</p>;
}
