import { useEffect, useEffectEvent } from 'react';
import { leggiStatoSincronizzazione } from '../api/eventi';
import { useRisorsa } from '../catalogo/useRisorsa';
import { t } from '../localizzazione/lingua';
import { dataControllo } from '../catalogo/formato';
export function AggiornamentoEventi() {
    const { stato, riprova } = useRisorsa('ticketmaster:stato', leggiStatoSincronizzazione);
    const aggiorna = useEffectEvent(riprova);
    useEffect(() => {
        const timer = setInterval(() => aggiorna(), 300000);
        return () => clearInterval(timer);
    }, []);
    if (stato.tipo === 'caricamento') return null;
    if (stato.tipo === 'errore') return <p role="status">{t('sync.statusUnavailable')}</p>;
    const s = stato.dati;
    return <div role="status" aria-live="polite">
        {!s.configurata ? <p>{t('sync.notConfigured')}</p> : !s.attiva ? <p>{t('sync.disabled')}</p> : null}
        {s.ultimo_successo ? <p>{t('sync.lastUpdate')}{' '}<time dateTime={s.ultimo_successo}>{dataControllo(s.ultimo_successo)}</time></p>
            : s.configurata ? <p>{t('sync.notYetUpdated')}</p> : null}
        {s.configurata && s.errore_temporaneo ? <p>{t('sync.error')}</p> : null}
        {s.configurata && s.parziale ? <p>{t('sync.partial')}</p> : null}
        {s.configurata && s.dati_vecchi && s.ultimo_successo ? <p>{t('sync.stale')}</p> : null}
    </div>;
}
