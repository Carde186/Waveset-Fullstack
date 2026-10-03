import type { ReactNode } from 'react';
import { t, type Chiave } from '../localizzazione/lingua';
import stile from './Avviso.module.css';

type TipoAvviso = 'info' | 'errore' | 'successo';

const ETICHETTE: Record<TipoAvviso, Chiave> = {
    info: 'common.info',
    errore: 'text.error',
    successo: 'common.done',
};

// Avviso nello stile «nota» dell'anteprima Club. Il tipo si legge dal testo
// dell'etichetta e dal filetto, non dal solo colore. Gli errori sono annunciati
// subito dai lettori di schermo (role="alert"), gli altri in modo discreto.
export function Avviso({ tipo = 'info', children }: { tipo?: TipoAvviso; children: ReactNode }) {
    return (
        <div
            className={`${stile.avviso} ${tipo === 'errore' ? stile.errore : ''} ${tipo === 'successo' ? stile.successo : ''}`}
            role={tipo === 'errore' ? 'alert' : 'status'}
        >
            <span className={stile.etichetta}>{t(ETICHETTE[tipo])}</span>
            {children}
        </div>
    );
}
