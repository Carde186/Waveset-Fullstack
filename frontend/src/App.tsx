import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
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

// Finché la sessione non è nota (controllo iniziale con /auth/io) o se il backend
// non ha risposto, si mostra lo stato relativo invece di indovinare.
function useAttesaSessione(): ReactNode | null {
    const { stato, riprova } = useAutenticazione();

    if (stato.tipo === 'caricamento') {
        return <StatoCaricamento testo="Controllo la sessione…" />;
    }
    if (stato.tipo === 'errore') {
        return (
            <StatoErrore
                titolo="Il server non risponde."
                messaggio={stato.messaggio}
                suRiprova={() => void riprova()}
            />
        );
    }

    return null;
}

function SoloAutenticati({ children }: { children: ReactNode }) {
    const { stato } = useAutenticazione();
    const attesa = useAttesaSessione();

    if (attesa !== null) {
        return attesa;
    }

    return stato.tipo === 'autenticato' ? children : <Navigate to="/accedi" replace />;
}

function SoloAnonimi({ children }: { children: ReactNode }) {
    const { stato } = useAutenticazione();
    const attesa = useAttesaSessione();

    if (attesa !== null) {
        return attesa;
    }

    return stato.tipo === 'autenticato' ? <Navigate to="/area" replace /> : children;
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
    return (
        <>
            <a className="salta-al-contenuto" href="#contenuto">
                Vai al contenuto
            </a>
            <Intestazione />
            <main id="contenuto" tabIndex={-1}>
                <Routes>
                    <Route path="/" element={<Iniziale />} />
                    <Route path="/esplora" element={<Esplora />} />
                    <Route path="/eventi" element={<Eventi />} />
                    <Route path="/eventi/:id" element={<DettaglioEvento />} />
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
                                titolo="Pagina non trovata."
                                messaggio="L'indirizzo che hai aperto non esiste."
                                azione={{ testo: "Torna all'inizio", verso: '/' }}
                            />
                        }
                    />
                </Routes>
            </main>
        </>
    );
}
