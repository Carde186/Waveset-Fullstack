import { useState } from 'react';
import { useLocation } from 'react-router';
import { leggiCopertine, type CopertinaVetrina } from '../api/discografia';
import { useRisorsa } from '../catalogo/useRisorsa';
import { selezionaCopertine } from '../catalogo/copertineVetrina';
import { t } from '../localizzazione/lingua';
import stile from './Vetrina.module.css';
function Cover({ cover }: { cover: CopertinaVetrina }) {
    const [fallita, impostaFallita] = useState(false);
    return fallita ? <div className={stile.coverAssente} aria-hidden="true">{'W'}</div> :
        <img src={cover.url} alt={t('catalog.cover', { name: cover.titolo })} referrerPolicy="no-referrer" onError={() => impostaFallita(true)} />;
}
export function CopertineVetrina() {
    const { pathname } = useLocation();
    const { stato } = useRisorsa('copertine-vetrina', leggiCopertine);
    const tutte = stato.tipo === 'pronto' ? stato.dati : [];
    const selezionate = selezionaCopertine(tutte, pathname);
    return <div className={stile.copertine} data-testid="copertine-vetrina">
        {selezionate.length ? selezionate.map(c => <Cover key={c.id} cover={c} />) :
            <div className={stile.coverAssente} aria-label={t('music.coverUnavailable')}>{'W'}</div>}
    </div>;
}
