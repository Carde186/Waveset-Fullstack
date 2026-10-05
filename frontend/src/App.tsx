import { testoMessaggio } from './api/messaggi';
import { useEffect } from 'react';
import { t, useLingua } from './localizzazione/lingua';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAutenticazione } from './autenticazione/contesto';
import { Intestazione } from './componenti/Intestazione';
import { StatoCaricamento, StatoErrore, StatoVuoto } from './componenti/Stati';
import { Accedi } from './schermate/Accedi';
import { Area } from './schermate/Area';
import { Registrati } from './schermate/Registrati';
import { Esplora } from './schermate/Esplora';
import { DettaglioAlbum, DettaglioArtista, DettaglioBrano } from './schermate/DettagliCatalogo';
import { Eventi } from './schermate/Eventi';
import { DettaglioEvento } from './schermate/DettaglioEvento';
import { ImpostazioniAccount } from './schermate/ImpostazioniAccount';
import { AdminEventi, DettaglioRevisioneEvento } from './schermate/AdminEventi';
import { AdminArtisti, DettaglioAdminArtista } from './schermate/AdminArtisti';
import { ArtistiSeguiti } from './schermate/ArtistiSeguiti';
import { ritornoDopoAccesso } from './autenticazione/ritorno';

// Finché la sessione non è nota (controllo iniziale con /auth/io) o se il backend
// non ha risposto, si mostra lo stato relativo invece di indovinare.
function useAttesaSessione(): ReactNode | null {
    const { stato, riprova } = useAutenticazione();

    if (stato.tipo === 'caricamento') {
        return <StatoCaricamento testo={t('text.checkingYourSession')} />;
    }
    if (stato.tipo === 'errore') {
        return (
            <StatoErrore
                titolo={t('text.theServerIsNotResponding')}
                messaggio={testoMessaggio(stato.messaggio)}
                suRiprova={() => void riprova()}
            />
        );
    }

    return null;
}

function SoloAutenticati({ children }: { children: ReactNode }) {
    const { stato } = useAutenticazione();
    const posizione = useLocation();
    const attesa = useAttesaSessione();

    if (attesa !== null) {
        return attesa;
    }

    return stato.tipo === 'autenticato' ? children : <Navigate to="/accedi" replace
        state={posizione.pathname === '/artisti-seguiti' ? { ritorno: posizione.pathname } : undefined} />;
}

function SoloAnonimi({ children }: { children: ReactNode }) {
    const { stato } = useAutenticazione();
    const posizione = useLocation();
    const attesa = useAttesaSessione();

    if (attesa !== null) {
        return attesa;
    }

    return stato.tipo === 'autenticato' ? <Navigate to={ritornoDopoAccesso(posizione.state) ?? '/area'} replace /> : children;
}

function SoloAdmin({ children }: { children: ReactNode }) {
    const { stato } = useAutenticazione();
    const attesa = useAttesaSessione();
    if (attesa !== null) return attesa;
    if (stato.tipo !== 'autenticato') return <Navigate to="/accedi" replace />;
    if (stato.utente.ruolo !== 'ADMIN') return <StatoVuoto occhiello="403" titolo={t('adminEvents.onlyAdmin')}
        messaggio={t('adminEvents.denied')} azione={{ testo: t('text.events'), verso: '/eventi' }} />;
    return children;
}

function Iniziale() {
    const { stato } = useAutenticazione();
    const attesa = useAttesaSessione();

    if (attesa !== null) {
        return attesa;
    }

    return <Navigate to={stato.tipo === 'autenticato' ? '/area' : '/accedi'} replace />;
}

export function App() {
    const lingua = useLingua();
    useEffect(() => { document.documentElement.lang = lingua; document.title = t('app.title'); }, [lingua]);
    return (
        <>
            <a className="salta-al-contenuto" href="#contenuto">
                {t('text.skipToContent')}</a>
            <Intestazione />
            <main id="contenuto" tabIndex={-1}>
                <Routes>
                    <Route path="/" element={<Iniziale />} />
                    <Route path="/esplora" element={<Esplora />} />
                    <Route path="/artisti-seguiti" element={<SoloAutenticati><ArtistiSeguiti /></SoloAutenticati>} />
                    <Route path="/impostazioni" element={<SoloAutenticati><ImpostazioniAccount /></SoloAutenticati>} />
                    <Route path="/eventi" element={<Eventi />} />
                    <Route path="/eventi/:id" element={<DettaglioEvento />} />
                    <Route path="/admin/eventi" element={<SoloAdmin><AdminEventi /></SoloAdmin>} />
                    <Route path="/admin/eventi/:id" element={<SoloAdmin><DettaglioRevisioneEvento /></SoloAdmin>} />
                    <Route path="/admin/artisti" element={<SoloAdmin><AdminArtisti /></SoloAdmin>} />
                    <Route path="/admin/artisti/:id" element={<SoloAdmin><DettaglioAdminArtista /></SoloAdmin>} />
                    <Route path="/artisti/:id" element={<DettaglioArtista />} />
                    <Route path="/brani/:id" element={<DettaglioBrano />} />
                    <Route path="/album/:id" element={<DettaglioAlbum />} />
                    <Route
                        path="/accedi"
                        element={
                            <SoloAnonimi>
                                <Accedi />
                            </SoloAnonimi>
                        }
                    />
                    <Route
                        path="/registrati"
                        element={
                            <SoloAnonimi>
                                <Registrati />
                            </SoloAnonimi>
                        }
                    />
                    <Route
                        path="/area"
                        element={
                            <SoloAutenticati>
                                <Area />
                            </SoloAutenticati>
                        }
                    />
                    <Route
                        path="*"
                        element={
                            <StatoVuoto
                                occhiello="404"
                                titolo={t('text.pageNotFound')}
                                messaggio={t('text.theAddressYouOpenedDoesNot')}
                                azione={{ testo: t('common.returnHome'), verso: '/' }}
                            />
                        }
                    />
                </Routes>
            </main>
        </>
    );
}
