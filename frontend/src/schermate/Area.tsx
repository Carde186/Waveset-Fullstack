import { useState } from 'react';
import { messaggioUscita } from '../api/messaggi';
import { useAutenticazione } from '../autenticazione/contesto';
import { Avviso } from '../componenti/Avviso';
import { Bottone } from '../componenti/Bottone';
import { Vetrina } from '../componenti/Vetrina';
import stile from './Area.module.css';

// Area autenticata essenziale: chi sei e come uscire. Nient'altro: le altre sezioni
// Playlist arriverà in un incremento successivo; Esplora ed Eventi sono nella barra.
export function Area() {
    const { stato, esci, esciDaTutti } = useAutenticazione();
    const [inCorso, impostaInCorso] = useState<'uscita' | 'uscita-tutti' | null>(null);
    const [confermaTutti, impostaConfermaTutti] = useState(false);
    const [errore, impostaErrore] = useState<string | null>(null);

    if (stato.tipo !== 'autenticato') {
        return null;
    }

    const { utente } = stato;

    async function chiudi(tipo: 'uscita' | 'uscita-tutti') {
        impostaErrore(null);
        impostaInCorso(tipo);

        try {
            // Con successo (o con 401) la sessione passa ad «anonimo» e le guardie in
            // App.tsx portano alla schermata di accesso.
            await (tipo === 'uscita' ? esci() : esciDaTutti());
        } catch (causa) {
            impostaErrore(messaggioUscita(causa));
            impostaInCorso(null);
        }
    }

    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">La tua area</div>
                <h1 className="titolo-medio">Ciao, {utente.nome}.</h1>
                <p>Sei dentro. Da qui puoi controllare chi sei e chiudere la sessione.</p>
                <ul className={stile.dati} aria-label="I tuoi dati">
                    <li>{utente.email}</li>
                    <li>Ruolo: {utente.ruolo}</li>
                </ul>
            </Vetrina>

            <div className="sezione">
                <h2>La sessione</h2>
            </div>

            {errore ? <Avviso tipo="errore">{errore}</Avviso> : null}

            <div className={stile.carte}>
                <div className={stile.carta}>
                    <div>
                        <small>Questo browser</small>
                        <p>Chiude la sessione di questo browser e ti riporta all&apos;accesso.</p>
                    </div>
                    <div>
                        <Bottone onClick={() => void chiudi('uscita')} disabled={inCorso !== null}>
                            {inCorso === 'uscita' ? 'Uscita in corso…' : 'Esci ↗'}
                        </Bottone>
                    </div>
                </div>

                <div className={stile.carta}>
                    <div>
                        <small>Tutti i dispositivi</small>
                        <p>
                            Chiude tutte le tue sessioni, anche quelle di altri browser e
                            dell&apos;app Android.
                        </p>
                    </div>
                    <div>
                        {confermaTutti ? (
                            <div className={stile.conferma}>
                                <Bottone
                                    onClick={() => void chiudi('uscita-tutti')}
                                    disabled={inCorso !== null}
                                >
                                    {inCorso === 'uscita-tutti'
                                        ? 'Uscita in corso…'
                                        : 'Sì, esci da tutti'}
                                </Bottone>
                                <Bottone
                                    variante="contorno"
                                    onClick={() => impostaConfermaTutti(false)}
                                    disabled={inCorso !== null}
                                >
                                    Annulla
                                </Bottone>
                            </div>
                        ) : (
                            <Bottone
                                variante="contorno"
                                onClick={() => impostaConfermaTutti(true)}
                                disabled={inCorso !== null}
                            >
                                Esci da tutti i dispositivi
                            </Bottone>
                        )}
                    </div>
                </div>
            </div>

            <div className="piede">
                Progetto didattico. Eventi e Playlist arriveranno nei prossimi incrementi.
            </div>
        </section>
    );
}
