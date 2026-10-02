import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { registrati } from '../api/autenticazione';
import { ErroreApi } from '../api/client';
import { messaggioRegistrazione } from '../api/messaggi';
import type { CampoRegistrazione } from '../api/tipi';
import { Avviso } from '../componenti/Avviso';
import { Bottone } from '../componenti/Bottone';
import { CampoTesto } from '../componenti/CampoTesto';
import { Vetrina } from '../componenti/Vetrina';
import stile from './Accesso.module.css';

type ErroriCampi = Partial<Record<CampoRegistrazione, string>>;

const CAMPI: CampoRegistrazione[] = ['nome', 'email', 'password'];

// «almeno 12 caratteri» -> «Almeno 12 caratteri.»
function comeFrase(motivo: string): string {
    const testo = motivo.charAt(0).toUpperCase() + motivo.slice(1);

    return testo.endsWith('.') ? testo : `${testo}.`;
}

// Il backend risponde 400 { messaggio, campi: { nome?, email?, password?, corpo? } }.
function erroriDalServer(causa: ErroreApi): ErroriCampi {
    const errori: ErroriCampi = {};

    for (const campo of CAMPI) {
        const motivo = causa.campi?.[campo];

        if (motivo !== undefined) {
            errori[campo] = comeFrase(motivo);
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
    const [errore, impostaErrore] = useState<string | null>(null);
    const [invio, impostaInvio] = useState(false);

    async function suInvio(evento: SubmitEvent<HTMLFormElement>) {
        evento.preventDefault();

        const dati = { nome: nome.trim(), email: email.trim(), password };
        const mancanti: ErroriCampi = {};

        if (dati.nome === '') {
            mancanti.nome = 'Inserisci il tuo nome.';
        }
        if (dati.email === '') {
            mancanti.email = 'Inserisci la tua email.';
        }
        if (dati.password === '') {
            mancanti.password = 'Scegli una password.';
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
                impostaErroriCampi({ email: 'Questa email è già registrata.' });
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
                <div className="occhiello">Registrazione</div>
                <h1 className="titolo-medio">Crea il tuo account.</h1>
                <p className="introduzione">
                    Dopo la registrazione accedi con la stessa email e la stessa password.
                </p>

                <form className={stile.modulo} onSubmit={suInvio} noValidate>
                    {errore ? <Avviso tipo="errore">{errore}</Avviso> : null}

                    <CampoTesto
                        etichetta="Nome"
                        name="nome"
                        autoComplete="name"
                        value={nome}
                        onChange={(e) => impostaNome(e.target.value)}
                        errore={erroriCampi.nome}
                        disabled={invio}
                    />
                    <CampoTesto
                        etichetta="Email"
                        type="email"
                        name="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => impostaEmail(e.target.value)}
                        errore={erroriCampi.email}
                        disabled={invio}
                    />
                    <CampoTesto
                        etichetta="Password"
                        type="password"
                        name="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => impostaPassword(e.target.value)}
                        suggerimento="Almeno 12 caratteri, al massimo 72 byte."
                        errore={erroriCampi.password}
                        disabled={invio}
                    />

                    <div className={stile.azioni}>
                        <Bottone type="submit" disabled={invio}>
                            {invio ? 'Registrazione in corso…' : 'Registrati ↗'}
                        </Bottone>
                        <p className={stile.alternativa}>
                            Hai già un account? <Link to="/accedi">Accedi</Link>
                        </p>
                    </div>
                </form>
            </Vetrina>
        </section>
    );
}
