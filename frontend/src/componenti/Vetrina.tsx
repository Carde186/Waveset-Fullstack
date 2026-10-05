import type { ReactNode } from 'react';
import stile from './Vetrina.module.css';
import { CopertineVetrina } from './CopertineVetrina';

// I dettagli forniscono la propria immagine; gli altri hero usano copertine ufficiali.
export function Vetrina({ children, visuale, visualeEstesa = false }: { children: ReactNode; visuale?: ReactNode; visualeEstesa?: boolean }) {
    return (
        <div className={`${stile.vetrina} ${visualeEstesa ? stile.estesa : ''}`}>
            <div className={stile.copia}>{children}</div>
            {visuale ? <div className={visualeEstesa ? stile.visualeEstesa : stile.visuale}>{visuale}</div> : <CopertineVetrina />}
        </div>
    );
}
