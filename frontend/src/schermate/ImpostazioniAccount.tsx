import { useRef, useState, type SubmitEvent } from 'react';
import { cambiaEmail, cambiaPassword } from '../api/autenticazione';
import { ErroreApi } from '../api/client';
import { useAutenticazione } from '../autenticazione/contesto';
import { Avviso } from '../componenti/Avviso';
import { Bottone } from '../componenti/Bottone';
import { CampoTesto } from '../componenti/CampoTesto';
import { StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { t, type Chiave } from '../localizzazione/lingua';
import stile from './Accesso.module.css';
import stileAccount from './ImpostazioniAccount.module.css';

function emailValida(v: string): boolean {
    const email = v.trim().toLowerCase();
    const dominio = email.split('@')[1];
    return (
        Array.from(email).length <= 255 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        !Array.from(email).some((c) => {
            const n = c.codePointAt(0)!;
            return n <= 31 || (n >= 127 && n <= 159);
        }) &&
        dominio !== 'waveset.test' &&
        !dominio?.endsWith('.waveset.test')
    );
}
function passwordValida(v: string): boolean {
    return (
        Array.from(v).length >= 12 &&
        new TextEncoder().encode(v).length <= 72 &&
        !v.includes('\0') &&
        /\p{L}/u.test(v) &&
        /[\p{N}\p{P}\p{S}]/u.test(v)
    );
}

function erroreAccount(causa: unknown): Chiave {
    if (causa instanceof ErroreApi) {
        if (causa.codice === 'CURRENT_PASSWORD_INVALID') return 'account.wrongPassword';
        if (causa.codice === 'EMAIL_EXISTS') return 'common.emailExists';
        if (causa.codice === 'ACCOUNT_CHANGED') return 'account.changed';
        if (causa.codice === 'INVALID_INPUT') {
            if (causa.campi?.nuovaEmail) return 'account.invalidEmail';
            if (causa.campi?.nuovaPassword) return 'account.invalidPassword';
            if (causa.campi?.confermaEmail) return 'account.emailMismatch';
            if (causa.campi?.confermaPassword) return 'account.passwordMismatch';
        }
        if (causa.stato === 401) return 'account.expired';
        if (causa.stato === 403) return 'account.denied';
        if (causa.stato === 429) return 'error.rate';
        if (causa.stato === 400) return 'common.invalidData';
    }
    return 'account.server';
}

function FormCambio({
    tipo,
    occupato,
    inizia,
    termina,
}: {
    tipo: 'email' | 'password';
    occupato: boolean;
    inizia: () => boolean;
    termina: () => void;
}) {
    const { aggiornaUtente, riprova } = useAutenticazione();
    const [corrente, impostaCorrente] = useState('');
    const [nuovo, impostaNuovo] = useState('');
    const [conferma, impostaConferma] = useState('');
    const [errori, impostaErrori] = useState<{
        corrente?: Chiave;
        nuovo?: Chiave;
        conferma?: Chiave;
    }>({});
    const [esito, impostaEsito] = useState<{ tipo: 'errore' | 'successo'; chiave: Chiave } | null>(
        null,
    );
    const email = tipo === 'email';
    const titolo = email ? 'account.changeEmail' : 'account.changePassword';

    async function invia(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        if (occupato) return;
        const valore = email ? nuovo.trim().toLowerCase() : nuovo;
        const ripetuto = email ? conferma.trim().toLowerCase() : conferma;
        const mancanti: typeof errori = {};
        if (!corrente) mancanti.corrente = 'common.passwordRequired';
        if (!(email ? emailValida(valore) : passwordValida(valore)))
            mancanti.nuovo = email ? 'account.invalidEmail' : 'account.invalidPassword';
        if (valore !== ripetuto)
            mancanti.conferma = email ? 'account.emailMismatch' : 'account.passwordMismatch';
        impostaErrori(mancanti);
        impostaEsito(null);
        if (Object.keys(mancanti).length || !inizia()) return;
        try {
            if (email)
                aggiornaUtente(
                    await cambiaEmail({
                        passwordCorrente: corrente,
                        nuovaEmail: valore,
                        confermaEmail: ripetuto,
                    }),
                );
            else
                await cambiaPassword({
                    passwordCorrente: corrente,
                    nuovaPassword: valore,
                    confermaPassword: ripetuto,
                });
            impostaNuovo('');
            impostaConferma('');
            impostaEsito({
                tipo: 'successo',
                chiave: email ? 'account.emailSuccess' : 'account.passwordSuccess',
            });
        } catch (causa) {
            impostaEsito({ tipo: 'errore', chiave: erroreAccount(causa) });
            if (causa instanceof ErroreApi && causa.stato === 401) await riprova();
        } finally {
            impostaCorrente('');
            if (!email) {
                impostaNuovo('');
                impostaConferma('');
            }
            termina();
        }
    }
    return (
        <section className={stileAccount.carta} aria-label={t(titolo)}>
            <h2>{t(titolo)}</h2>
            <form className={stile.modulo} onSubmit={invia} noValidate>
                {esito ? <Avviso tipo={esito.tipo}>{t(esito.chiave)}</Avviso> : null}
                <CampoTesto
                    etichetta={t('account.currentPassword')}
                    type="password"
                    autoComplete="current-password"
                    name="passwordCorrente"
                    value={corrente}
                    onChange={(e) => impostaCorrente(e.target.value)}
                    disabled={occupato}
                    errore={errori.corrente ? t(errori.corrente) : undefined}
                    required
                />
                <CampoTesto
                    etichetta={t(email ? 'account.newEmail' : 'account.newPassword')}
                    type={email ? 'email' : 'password'}
                    autoComplete={email ? 'email' : 'new-password'}
                    name={email ? 'nuovaEmail' : 'nuovaPassword'}
                    value={nuovo}
                    onChange={(e) => impostaNuovo(e.target.value)}
                    disabled={occupato}
                    required
                    suggerimento={email ? undefined : t('account.passwordHint')}
                    errore={errori.nuovo ? t(errori.nuovo) : undefined}
                />
                <CampoTesto
                    etichetta={t(email ? 'account.confirmEmail' : 'account.confirmPassword')}
                    type={email ? 'email' : 'password'}
                    autoComplete={email ? 'email' : 'new-password'}
                    name={email ? 'confermaEmail' : 'confermaPassword'}
                    value={conferma}
                    onChange={(e) => impostaConferma(e.target.value)}
                    disabled={occupato}
                    required
                    errore={errori.conferma ? t(errori.conferma) : undefined}
                />
                <Bottone type="submit" disabled={occupato}>
                    {t(occupato ? 'account.saving' : titolo)}
                </Bottone>
            </form>
        </section>
    );
}

export function ImpostazioniAccount() {
    const { stato } = useAutenticazione();
    const [occupato, impostaOccupato] = useState(false);
    const blocco = useRef(false);
    if (stato.tipo !== 'autenticato') return null;
    if (stato.utente.ruolo !== 'USER')
        return (
            <StatoVuoto
                occhiello={t('account.title')}
                titolo={t('account.userOnly')}
                messaggio={t('account.denied')}
                azione={{ testo: t('text.account'), verso: '/area' }}
            />
        );
    const inizia = () => {
        if (blocco.current) return false;
        blocco.current = true;
        impostaOccupato(true);
        return true;
    };
    const termina = () => {
        blocco.current = false;
        impostaOccupato(false);
    };
    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">{t('text.yourAccount')}</div>
                <h1 className="titolo-medio">{t('account.title')}</h1>
                <p>{t('account.intro')}</p>
                <p>{t('account.currentEmail', { email: stato.utente.email })}</p>
            </Vetrina>
            <div className={stileAccount.griglia}>
                <FormCambio tipo="email" occupato={occupato} inizia={inizia} termina={termina} />
                <FormCambio tipo="password" occupato={occupato} inizia={inizia} termina={termina} />
            </div>
        </section>
    );
}
