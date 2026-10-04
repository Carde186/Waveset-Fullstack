import type { ReactNode } from 'react';
import stile from './Vetrina.module.css';

// L'arte è decorativa (aria-hidden): non è una foto di un artista né un artwork.
export function Vetrina({ children, visuale, visualeEstesa = false }: { children: ReactNode; visuale?: ReactNode; visualeEstesa?: boolean }) {
    return (
        <div className={`${stile.vetrina} ${visualeEstesa ? stile.estesa : ''}`}>
            <div className={stile.copia}>{children}</div>
            {visuale ? <div className={visualeEstesa ? stile.visualeEstesa : stile.visuale}>{visuale}</div> : <div className={stile.arte} aria-hidden="true" />}
        </div>
    );
}
