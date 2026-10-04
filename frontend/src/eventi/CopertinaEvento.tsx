import { useState } from 'react';
import type { Evento } from '../api/eventi';
import { t } from '../localizzazione/lingua';
import stile from './CopertinaEvento.module.css';

function Segnaposto() {
    return <div className={stile.segnaposto}>
        <svg viewBox="0 0 80 80" aria-hidden="true" focusable="false">
            <rect x="12" y="19" width="56" height="49" rx="8" />
            <path d="M12 34h56M28 12v14M52 12v14M27 46h8M45 46h8M27 56h8M45 56h8" />
        </svg>
        <span>{t('events.coverUnavailable')}</span>
    </div>;
}
function Foto({ url, titolo, prioritaria }: { url: string; titolo: string; prioritaria: boolean }) {
    const [fallita, impostaFallita] = useState(false);
    return fallita ? <Segnaposto /> : <img src={url} alt={t('events.cover', { title: titolo })}
        loading={prioritaria ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => impostaFallita(true)} />;
}

// La foto della lineup non è mai consultata: assenza/errore => segnaposto evento.
export function CopertinaEvento({ evento, hero = false }: { evento: Evento; hero?: boolean }) {
    return <div className={`${stile.copertina} ${hero ? stile.hero : ''}`}>
        {evento.immagineUrl ? <Foto key={evento.immagineUrl} url={evento.immagineUrl} titolo={evento.titolo} prioritaria={hero} /> : <Segnaposto />}
    </div>;
}
