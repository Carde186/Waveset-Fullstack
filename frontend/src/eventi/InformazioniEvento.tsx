import { t } from '../localizzazione/lingua';
import { Link } from 'react-router';
import type { Evento } from '../api/eventi';
import { dataCatalogo, dataControllo } from '../catalogo/formato';
import stile from './Eventi.module.css';

export function InformazioniEvento({ evento }: { evento: Evento }) {
    return <>
        <p><time dateTime={evento.dataEvento}>{dataCatalogo(evento.dataEvento)}</time> · {evento.oraEvento?.slice(0, 5) ?? t('catalog.timeUnavailable')}</p>
        <p>{[evento.luogo, evento.citta].filter(Boolean).join(' · ') || t('catalog.locationUnavailable')}</p>
        {evento.fonte ? <>
            <p>{t('sync.eventSource')}{evento.fonte.ultimoControllo ? <>{' '}<time dateTime={evento.fonte.ultimoControllo}>{dataControllo(evento.fonte.ultimoControllo)}</time></> : null}</p>
            {evento.fonte.stato === 'postponed' ? <p>{t('sync.postponed')}</p> : null}
            {evento.fonte.stato === 'rescheduled' ? <p>{t('sync.rescheduled')}</p> : null}
            {evento.fonte.modifiche ? <p>{t('sync.changes')}</p> : null}
            {evento.fonte.assente ? <p>{t('sync.missing')}</p> : null}
        </> : null}
    </>;
}

export function LineupEvento({ evento }: { evento: Evento }) {
    return evento.lineup.length ? <ul className={stile.lineup} aria-label={t('events.lineup', { name: evento.titolo })}>
        {evento.lineup.map((a) => <li key={a.id}><Link to={`/artisti/${a.id}`}>{a.nome} ↗</Link></li>)}
    </ul> : <p>{t('text.lineupUnavailable')}</p>;
}
