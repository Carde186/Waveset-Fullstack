import { Link, NavLink } from 'react-router';
import { useAutenticazione } from '../autenticazione/contesto';
import stile from './Intestazione.module.css';

const classeVoce = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${stile.voce} ${stile.attiva}` : stile.voce;

// Barra orizzontale dell'anteprima Club: marchio a sinistra, voci di navigazione,
// azione dell'account a destra. Mostra SOLO voci che portano a schermate reali.
export function Intestazione() {
    const { stato } = useAutenticazione();

    return (
        <header className={stile.barra}>
            <Link className={stile.marchio} to="/" aria-label="Waveset, pagina iniziale">
                WAVESET<span>.</span>
            </Link>
            <nav className={stile.navigazione} aria-label="Principale">
                <NavLink to="/esplora" className={classeVoce}>
                    Esplora
                </NavLink>
                {stato.tipo === 'autenticato' ? (
                    <NavLink to="/area" className={classeVoce}>
                        Area
                    </NavLink>
                ) : null}
                {stato.tipo === 'anonimo' ? (
                    <>
                        <NavLink to="/accedi" className={classeVoce}>
                            Accedi
                        </NavLink>
                        <NavLink to="/registrati" className={classeVoce}>
                            Registrati
                        </NavLink>
                    </>
                ) : null}
            </nav>
            {stato.tipo === 'autenticato' ? (
                <Link className={stile.account} to="/area">
                    {stato.utente.nome} ↗
                </Link>
            ) : null}
        </header>
    );
}
