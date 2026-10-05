import { t, type Chiave } from '../localizzazione/lingua';
import { useState, type SubmitEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ErroreApi } from '../api/client';
import { messaggioAccesso, testoMessaggio, type Messaggio } from '../api/messaggi';
import { useAutenticazione } from '../autenticazione/contesto';
import { ritornoDopoAccesso } from '../autenticazione/ritorno';
import { Avviso } from '../componenti/Avviso';
import { Bottone } from '../componenti/Bottone';
import { CampoTesto } from '../componenti/CampoTesto';
import { Vetrina } from '../componenti/Vetrina';
import stile from './Accesso.module.css';

// Stato passato dalla registrazione: { registrato: true, email }.
function leggiRegistrazione(stato: unknown): { email: string } | null {
    if (
        typeof stato === 'object' &&
        stato !== null &&
        'registrato' in stato &&
        stato.registrato === true &&
        'email' in stato &&
        typeof stato.email === 'string'
    ) {
        return { email: stato.email };
    }

    return null;
}

export function Accedi() {
    const { accedi, stato } = useAutenticazione();
    const posizione = useLocation();
    const dopoRegistrazione = leggiRegistrazione(posizione.state);
    const ritorno = ritornoDopoAccesso(posizione.state);

    const [email, impostaEmail] = useState(dopoRegistrazione?.email ?? '');
    const [password, impostaPassword] = useState('');
    const [mancanti, impostaMancanti] = useState<{ email?: Chiave; password?: Chiave }>({});
    const [errore, impostaErrore] = useState<Messaggio | null>(null);
    const [invio, impostaInvio] = useState(false);

    async function suInvio(evento: SubmitEvent<HTMLFormElement>) {
        evento.preventDefault();

        const emailPulita = email.trim();
        const nuoviMancanti: { email?: Chiave; password?: Chiave } = {};

        if (emailPulita === '') {
            nuoviMancanti.email = 'common.emailRequired';
        }
        if (password === '') {
            nuoviMancanti.password = 'common.passwordRequired';
        }
        impostaMancanti(nuoviMancanti);
        impostaErrore(null);

        if (Object.keys(nuoviMancanti).length > 0) {
            return;
        }

        impostaInvio(true);

        try {
            // Se riesce, la sessione passa a «autenticato» e la schermata porta da sola
            // al profilo artista richiesto oppure all'area (guardie in App.tsx).
            await accedi(emailPulita, password);
        } catch (causa) {
            impostaErrore(messaggioAccesso(causa));
            if (causa instanceof ErroreApi && causa.stato === 401) {
                impostaPassword('');
            }
        } finally {
            impostaInvio(false);
        }
    }

    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">{t('text.login')}</div>
                <h1 className="titolo-medio">{t('text.logIn2')}</h1>
                <p className="introduzione">{t('text.enterTheEmailYouUsedTo')}</p>

                <form className={stile.modulo} onSubmit={suInvio} noValidate>
                    {dopoRegistrazione ? (
                        <Avviso tipo="successo">
                            {t('text.registrationCompleteLogInWithYour')}</Avviso>
                    ) : null}
                    {stato.tipo === 'anonimo' && stato.scaduta ? (
                        <Avviso>{t('text.yourSessionIsNoLongerValid')}</Avviso>
                    ) : null}
                    {errore ? <Avviso tipo="errore">{testoMessaggio(errore)}</Avviso> : null}

                    <CampoTesto
                        etichetta={t('text.email')}
                        type="email"
                        name="email"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => impostaEmail(e.target.value)}
                        errore={mancanti.email ? t(mancanti.email) : undefined}
                        disabled={invio}
                    />
                    <CampoTesto
                        etichetta={t('text.password')}
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => impostaPassword(e.target.value)}
                        errore={mancanti.password ? t(mancanti.password) : undefined}
                        disabled={invio}
                    />

                    <div className={stile.azioni}>
                        <Bottone type="submit" disabled={invio}>
                            {invio ? t('login.pending') : t('login.submit')}
                        </Bottone>
                        <p className={stile.alternativa}>
                            {t('text.donTHaveAnAccount')}{' '}<Link to="/registrati" state={ritorno ? { ritorno } : undefined}>{t('text.signUp')}</Link>
                        </p>
                    </div>
                </form>
            </Vetrina>
        </section>
    );
}
