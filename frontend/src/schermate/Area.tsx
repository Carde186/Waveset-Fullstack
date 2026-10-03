import { t } from '../localizzazione/lingua';
import { useState } from 'react';
import { messaggioUscita, testoMessaggio, type Messaggio } from '../api/messaggi';
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
    const [errore, impostaErrore] = useState<Messaggio | null>(null);

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
                <div className="occhiello">{t('text.yourAccount')}</div>
                <h1 className="titolo-medio">{t('text.hi')}{' '}{utente.nome}.</h1>
                <p>{t('text.youReLoggedInHereYou')}</p>
                <ul className={stile.dati} aria-label={t('text.yourDetails')}>
                    <li>{utente.email}</li>
                    <li>{t('text.role')}{' '}{utente.ruolo}</li>
                </ul>
            </Vetrina>

            <div className="sezione">
                <h2>{t('text.session')}</h2>
            </div>

            {errore ? <Avviso tipo="errore">{testoMessaggio(errore)}</Avviso> : null}

            <div className={stile.carte}>
                <div className={stile.carta}>
                    <div>
                        <small>{t('text.thisBrowser')}</small>
                        <p>{t('text.endsThisBrowserSSessionAnd')}</p>
                    </div>
                    <div>
                        <Bottone onClick={() => void chiudi('uscita')} disabled={inCorso !== null}>
                            {inCorso === 'uscita' ? t('area.logoutPending') : t('area.logout')}
                        </Bottone>
                    </div>
                </div>

                <div className={stile.carta}>
                    <div>
                        <small>{t('text.allDevices')}</small>
                        <p>
                            {t('text.endsAllYourSessionsIncludingOther')}</p>
                    </div>
                    <div>
                        {confermaTutti ? (
                            <div className={stile.conferma}>
                                <Bottone
                                    onClick={() => void chiudi('uscita-tutti')}
                                    disabled={inCorso !== null}
                                >
                                    {inCorso === 'uscita-tutti'
                                        ? t('area.logoutPending')
                                        : t('area.confirmLogoutAll')}
                                </Bottone>
                                <Bottone
                                    variante="contorno"
                                    onClick={() => impostaConfermaTutti(false)}
                                    disabled={inCorso !== null}
                                >
                                    {t('text.cancel')}</Bottone>
                            </div>
                        ) : (
                            <Bottone
                                variante="contorno"
                                onClick={() => impostaConfermaTutti(true)}
                                disabled={inCorso !== null}
                            >
                                {t('text.logOutOfAllDevices')}</Bottone>
                        )}
                    </div>
                </div>
            </div>

            <div className="piede">
                {t('text.learningProjectEventsAndPlaylistsWill')}</div>
        </section>
    );
}
