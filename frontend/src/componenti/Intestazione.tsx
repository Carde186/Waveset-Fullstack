import { t } from '../localizzazione/lingua';
import { Link, NavLink } from 'react-router';
import { useAutenticazione } from '../autenticazione/contesto';
import stile from './Intestazione.module.css';
import { SelettoreLingua } from './SelettoreLingua';

const classeVoce = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${stile.voce} ${stile.attiva}` : stile.voce;

// Barra orizzontale dell'anteprima Club: marchio a sinistra, voci di navigazione,
// azione dell'account a destra. Mostra SOLO voci che portano a schermate reali.
export function Intestazione() {
    const { stato } = useAutenticazione();

    return (
        <header className={stile.barra}>
            <div className={stile.principale}>
                <Link className={stile.marchio} to="/" aria-label={t('text.wavesetHomePage')}>
                    {t('text.waveset')}<span>.</span>
                </Link>
                <nav className={stile.navigazione} aria-label={t('text.main')}>
                    <NavLink to="/esplora" className={classeVoce}>
                        {t('text.explore')}</NavLink>
                    <NavLink to="/eventi" className={classeVoce}>
                        {t('text.events')}</NavLink>
                    {stato.tipo === 'autenticato' && stato.utente.ruolo === 'USER' ? <NavLink to="/artisti-seguiti" className={classeVoce}>{t('follow.pageTitle')}</NavLink> : null}
                </nav>
            </div>
            <nav className={stile.azioniAccount} aria-label={t('text.yourAccount')}>
                <SelettoreLingua />
                {stato.tipo === 'autenticato' ? (
                    <NavLink to="/area" className={classeVoce}>
                        {t('text.account')}</NavLink>
                ) : null}
                {stato.tipo === 'autenticato' && stato.utente.ruolo === 'USER' ? <NavLink to="/impostazioni" className={classeVoce}>{t('account.title')}</NavLink> : null}
                {stato.tipo === 'autenticato' && stato.utente.ruolo === 'ADMIN' ? <NavLink to="/admin/eventi" className={classeVoce}>{t('adminEvents.nav')}</NavLink> : null}
                {stato.tipo === 'autenticato' && stato.utente.ruolo === 'ADMIN' ? <NavLink to="/admin/artisti" className={classeVoce}>{t('apple.nav')}</NavLink> : null}
                {stato.tipo === 'anonimo' ? (
                    <>
                        <NavLink to="/registrati" className={classeVoce}>
                            {t('text.signUp')}</NavLink>
                        <NavLink to="/accedi" className={classeVoce}>
                            {t('text.logIn')}</NavLink>
                    </>
                ) : null}
                {stato.tipo === 'autenticato' ? (
                    <Link className={stile.account} to="/area">
                        {stato.utente.nome} ↗
                    </Link>
                ) : null}
            </nav>
        </header>
    );
}
