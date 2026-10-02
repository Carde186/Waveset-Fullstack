import type { ReactNode } from 'react';
import stile from './Vetrina.module.css';

// L'arte è decorativa (aria-hidden): non è una foto di un artista né un artwork.
export function Vetrina({ children }: { children: ReactNode }) {
    return (
        <div className={stile.vetrina}>
            <div className={stile.copia}>{children}</div>
            <div className={stile.arte} aria-hidden="true" />
        </div>
    );
}
