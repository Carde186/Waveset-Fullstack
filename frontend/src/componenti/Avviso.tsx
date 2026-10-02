import type { ReactNode } from 'react';
import stile from './Avviso.module.css';

type TipoAvviso = 'info' | 'errore' | 'successo';

const ETICHETTE: Record<TipoAvviso, string> = {
    info: 'Info',
    errore: 'Errore',
    successo: 'Fatto',
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
            <span className={stile.etichetta}>{ETICHETTE[tipo]}</span>
            {children}
        </div>
    );
}
