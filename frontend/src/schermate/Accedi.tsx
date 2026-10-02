import { useState, type SubmitEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { ErroreApi } from '../api/client';
import { messaggioAccesso } from '../api/messaggi';
import { useAutenticazione } from '../autenticazione/contesto';
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

    const [email, impostaEmail] = useState(dopoRegistrazione?.email ?? '');
    const [password, impostaPassword] = useState('');
    const [mancanti, impostaMancanti] = useState<{ email?: string; password?: string }>({});
    const [errore, impostaErrore] = useState<string | null>(null);
    const [invio, impostaInvio] = useState(false);

    async function suInvio(evento: SubmitEvent<HTMLFormElement>) {
        evento.preventDefault();

        const emailPulita = email.trim();
        const nuoviMancanti: { email?: string; password?: string } = {};

        if (emailPulita === '') {
            nuoviMancanti.email = 'Inserisci la tua email.';
        }
        if (password === '') {
            nuoviMancanti.password = 'Inserisci la password.';
        }
        impostaMancanti(nuoviMancanti);
        impostaErrore(null);

        if (Object.keys(nuoviMancanti).length > 0) {
            return;
        }

        impostaInvio(true);

        try {
            // Se riesce, la sessione passa a «autenticato» e la schermata porta da sola
            // all'area (vedi le guardie in App.tsx).
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
                <div className="occhiello">Accesso</div>
                <h1 className="titolo-medio">Accedi.</h1>
                <p className="introduzione">Entra con l&apos;email con cui ti sei registrato.</p>

                <form className={stile.modulo} onSubmit={suInvio} noValidate>
                    {dopoRegistrazione ? (
                        <Avviso tipo="successo">
                            Registrazione completata. Accedi con la tua email e la tua password.
                        </Avviso>
                    ) : null}
                    {stato.tipo === 'anonimo' && stato.scaduta ? (
                        <Avviso>La sessione non è più valida. Accedi di nuovo.</Avviso>
                    ) : null}
                    {errore ? <Avviso tipo="errore">{errore}</Avviso> : null}

                    <CampoTesto
                        etichetta="Email"
                        type="email"
                        name="email"
                        autoComplete="username"
                        value={email}
                        onChange={(e) => impostaEmail(e.target.value)}
                        errore={mancanti.email}
                        disabled={invio}
                    />
                    <CampoTesto
                        etichetta="Password"
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => impostaPassword(e.target.value)}
                        errore={mancanti.password}
                        disabled={invio}
                    />

                    <div className={stile.azioni}>
                        <Bottone type="submit" disabled={invio}>
                            {invio ? 'Accesso in corso…' : 'Accedi ↗'}
                        </Bottone>
                        <p className={stile.alternativa}>
                            Non hai un account? <Link to="/registrati">Registrati</Link>
                        </p>
                    </div>
                </form>
            </Vetrina>
        </section>
    );
}
