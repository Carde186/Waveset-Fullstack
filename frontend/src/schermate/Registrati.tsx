import motiviServer from '../localizzazione/errori-server.json';
import { t, type Chiave } from '../localizzazione/lingua';
import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { registrati } from '../api/autenticazione';
import { ErroreApi } from '../api/client';
import { messaggioRegistrazione, testoMessaggio, type Messaggio } from '../api/messaggi';
import type { CampoRegistrazione } from '../api/tipi';
import { Avviso } from '../componenti/Avviso';
import { Bottone } from '../componenti/Bottone';
import { CampoTesto } from '../componenti/CampoTesto';
import { Vetrina } from '../componenti/Vetrina';
import stile from './Accesso.module.css';

type ErroriCampi = Partial<Record<CampoRegistrazione, Chiave>>;

const CAMPI: CampoRegistrazione[] = ['nome', 'email', 'password'];

// Solo motivi noti del contratto: mai testi arbitrari ricevuti dal server.
// Il backend risponde 400 { messaggio, campi: { nome?, email?, password?, corpo? } }.
function erroriDalServer(causa: ErroreApi): ErroriCampi {
    const errori: ErroriCampi = {};

    for (const campo of CAMPI) {
        const motivo = causa.campi?.[campo];

        if (motivo !== undefined) {
            errori[campo] = (motiviServer as Record<string, Chiave>)[motivo] ?? 'common.invalidData';
        }
    }

    return errori;
}

// Registrazione secondo il contratto reale: POST /api/auth/registrazione con
// { nome, email, password }. NON apre nessuna sessione: dopo il 201 si passa alla
// schermata di accesso con l'email già compilata.
export function Registrati() {
    const navigate = useNavigate();
    const [nome, impostaNome] = useState('');
    const [email, impostaEmail] = useState('');
    const [password, impostaPassword] = useState('');
    const [erroriCampi, impostaErroriCampi] = useState<ErroriCampi>({});
    const [errore, impostaErrore] = useState<Messaggio | null>(null);
    const [invio, impostaInvio] = useState(false);

    async function suInvio(evento: SubmitEvent<HTMLFormElement>) {
        evento.preventDefault();

        const dati = { nome: nome.trim(), email: email.trim(), password };
        const mancanti: ErroriCampi = {};

        if (dati.nome === '') {
            mancanti.nome = 'common.nameRequired';
        }
        if (dati.email === '') {
            mancanti.email = 'common.emailRequired';
        }
        if (dati.password === '') {
            mancanti.password = 'common.passwordChoose';
        }
        impostaErroriCampi(mancanti);
        impostaErrore(null);

        if (Object.keys(mancanti).length > 0) {
            return;
        }

        impostaInvio(true);

        try {
            const { utente } = await registrati(dati);

            navigate('/accedi', { state: { registrato: true, email: utente.email } });
        } catch (causa) {
            if (causa instanceof ErroreApi && causa.stato === 400) {
                const dalServer = erroriDalServer(causa);

                impostaErroriCampi(dalServer);
                // Un 400 senza errori per campo (per esempio «corpo») resta un errore generale.
                impostaErrore(
                    Object.keys(dalServer).length === 0 ? messaggioRegistrazione(causa) : null,
                );
            } else if (causa instanceof ErroreApi && causa.stato === 409) {
                impostaErroriCampi({ email: 'common.emailExists' });
            } else {
                impostaErrore(messaggioRegistrazione(causa));
            }
        } finally {
            impostaInvio(false);
        }
    }

    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">{t('text.registration')}</div>
                <h1 className="titolo-medio">{t('text.createYourAccount')}</h1>
                <p className="introduzione">
                    {t('text.afterSigningUpLogInWith')}</p>

                <form className={stile.modulo} onSubmit={suInvio} noValidate>
                    {errore ? <Avviso tipo="errore">{testoMessaggio(errore)}</Avviso> : null}

                    <CampoTesto
                        etichetta={t('text.name')}
                        name="nome"
                        autoComplete="name"
                        value={nome}
                        onChange={(e) => impostaNome(e.target.value)}
                        errore={erroriCampi.nome ? t(erroriCampi.nome) : undefined}
                        disabled={invio}
                    />
                    <CampoTesto
                        etichetta={t('text.email')}
                        type="email"
                        name="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => impostaEmail(e.target.value)}
                        errore={erroriCampi.email ? t(erroriCampi.email) : undefined}
                        disabled={invio}
                    />
                    <CampoTesto
                        etichetta={t('text.password')}
                        type="password"
                        name="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => impostaPassword(e.target.value)}
                        suggerimento={t('text.atLeast12CharactersNoMore')}
                        errore={erroriCampi.password ? t(erroriCampi.password) : undefined}
                        disabled={invio}
                    />

                    <div className={stile.azioni}>
                        <Bottone type="submit" disabled={invio}>
                            {invio ? t('registration.pending') : t('registration.submit')}
                        </Bottone>
                        <p className={stile.alternativa}>
                            {t('text.alreadyHaveAnAccount')}{' '}<Link to="/accedi">{t('text.logIn')}</Link>
                        </p>
                    </div>
                </form>
            </Vetrina>
        </section>
    );
}
