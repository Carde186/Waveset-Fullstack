import { t } from '../localizzazione/lingua';
import type { ReactNode } from 'react';
import { Bottone, BottoneLink } from './Bottone';
import stile from './Stati.module.css';

// Tre stati curati nello stesso stile (pannello, occhiello lime, titolo grande):
// caricamento, errore e vuoto.

type LivelloTitolo = 1 | 2 | 3;

export function StatoCaricamento({
    testo = t('common.loading'),
    livelloTitolo = 1,
}: {
    testo?: string;
    livelloTitolo?: LivelloTitolo;
}) {
    const Titolo = `h${livelloTitolo}` as 'h1' | 'h2' | 'h3';
    return (
        <section className="pagina" aria-busy="true">
            <div className={stile.stato} role="status">
                <div className="occhiello">{t('text.inProgress')}</div>
                <Titolo>{testo}</Titolo>
                <div className={stile.barra} aria-hidden="true" />
            </div>
        </section>
    );
}

export function StatoErrore({
    titolo = t('common.cannotContinue'),
    messaggio,
    suRiprova,
    livelloTitolo = 1,
}: {
    titolo?: string;
    messaggio: ReactNode;
    suRiprova?: () => void;
    livelloTitolo?: LivelloTitolo;
}) {
    const Titolo = `h${livelloTitolo}` as 'h1' | 'h2' | 'h3';
    return (
        <section className="pagina">
            <div className={stile.stato} role="alert">
                <div className="occhiello">{t('text.error')}</div>
                <Titolo>{titolo}</Titolo>
                <p>{messaggio}</p>
                {suRiprova ? <Bottone onClick={suRiprova}>{t('text.tryAgain')}</Bottone> : null}
            </div>
        </section>
    );
}

export function StatoVuoto({
    occhiello,
    titolo,
    messaggio,
    azione,
    livelloTitolo = 1,
}: {
    occhiello: string;
    titolo: string;
    messaggio: ReactNode;
    azione?: { testo: string; verso: string };
    livelloTitolo?: LivelloTitolo;
}) {
    const Titolo = `h${livelloTitolo}` as 'h1' | 'h2' | 'h3';
    return (
        <section className="pagina">
            <div className={stile.stato}>
                <div className="occhiello">{occhiello}</div>
                <Titolo>{titolo}</Titolo>
                <p>{messaggio}</p>
                {azione ? <BottoneLink to={azione.verso}>{azione.testo} ↗</BottoneLink> : null}
            </div>
        </section>
    );
}
