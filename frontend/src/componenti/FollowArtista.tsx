import { useRef, useState } from 'react';
import { impostaFollowArtista, type Artista } from '../api/catalogo';
import { ErroreApi } from '../api/client';
import { useAutenticazione } from '../autenticazione/contesto';
import { t, type Chiave } from '../localizzazione/lingua';
import { Avviso } from './Avviso';
import { Bottone } from './Bottone';

export function FollowArtista({ artista }: { artista: Artista }) {
    const { stato, riprova } = useAutenticazione();
    const [seguito, impostaSeguito] = useState(artista.seguito);
    const [occupato, impostaOccupato] = useState(false);
    const [errore, impostaErrore] = useState<Chiave | null>(null);
    const blocco = useRef(false);
    const puoSeguire = stato.tipo === 'autenticato' && stato.utente.ruolo === 'USER';
    async function cambia() {
        if (!puoSeguire || blocco.current) return;
        blocco.current = true;
        impostaOccupato(true);
        impostaErrore(null);
        try {
            await impostaFollowArtista(artista.id, !seguito);
            impostaSeguito(!seguito);
        } catch (causa) {
            const status = causa instanceof ErroreApi ? causa.stato : 0;
            impostaErrore(
                status === 401
                    ? 'follow.expired'
                    : status === 403
                      ? 'follow.denied'
                      : status === 404
                        ? 'follow.missing'
                        : 'follow.error',
            );
            if (status === 401) await riprova();
        } finally {
            blocco.current = false;
            impostaOccupato(false);
        }
    }
    return (
        <>
            {puoSeguire ? (
                <>
                    <p role="status" aria-live="polite">
                        {t(seguito ? 'follow.following' : 'follow.notFollowing')}
                    </p>
                    <Bottone
                        variante={seguito ? 'contorno' : 'primario'}
                        aria-pressed={seguito}
                        disabled={occupato}
                        onClick={() => void cambia()}
                    >
                        {t(
                            occupato
                                ? 'follow.pending'
                                : seguito
                                  ? 'follow.unfollow'
                                  : 'follow.follow',
                        )}
                    </Bottone>
                </>
            ) : null}
            {errore ? <Avviso tipo="errore">{t(errore)}</Avviso> : null}
        </>
    );
}
