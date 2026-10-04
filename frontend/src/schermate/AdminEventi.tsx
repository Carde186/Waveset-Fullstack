import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
    elencaCoda,
    leggiRevisione,
    rivalutaEvento,
    type EventoRevisione,
    type Valutazione,
} from '../api/adminEventi';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Bottone } from '../componenti/Bottone';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { locale, t } from '../localizzazione/lingua';
import stile from './AdminEventi.module.css';

function DatiValutazione({ v }: { v: Valutazione }) {
    const dati = [
        [
            t('ollama.confidence'),
            v.confidenza === null ? '—' : `${Math.round(v.confidenza * 100)}%`,
        ],
        [t('ollama.reason'), v.motivazione ?? '—'],
        [t('ollama.model'), v.modello ?? '—'],
        [t('ollama.date'), v.data ? new Date(v.data).toLocaleString(locale()) : '—'],
        [t('ollama.attempts'), String(v.tentativi)],
        [t('ollama.error'), v.errore ?? '—'],
    ];
    return (
        <>
            <span className={stile.stato}>{t(`ollama.${v.decisione}`)}</span>
            <dl className={stile.dati}>
                {dati.map(([k, v]) => (
                    <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                    </div>
                ))}
            </dl>
        </>
    );
}
function Rivaluta({ evento, aggiorna }: { evento: EventoRevisione; aggiorna: () => void }) {
    const [caricamento, impostaCaricamento] = useState(false);
    const [errore, impostaErrore] = useState(false);
    const [successo, impostaSuccesso] = useState(false);
    async function invia() {
        impostaCaricamento(true);
        impostaErrore(false);
        try {
            await rivalutaEvento(evento.id);
            impostaSuccesso(true);
            aggiorna();
        } catch {
            impostaErrore(true);
        } finally {
            impostaCaricamento(false);
        }
    }
    return (
        <div className={stile.azioni}>
            <Bottone
                disabled={caricamento || evento.valutazione.decisione === 'da_valutare'}
                onClick={() => void invia()}
            >
                {caricamento ? t('ollama.queuing') : t('ollama.reevaluate')}
            </Bottone>
            {successo && <p role="status">{t('ollama.queued')}</p>}
            {errore && <p role="alert">{t('ollama.actionError')}</p>}
        </div>
    );
}
export function AdminEventi() {
    const { stato, riprova } = useRisorsa('registro-ollama', elencaCoda);
    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">{'ADMIN'}</div>
                <h1 className="titolo">{t('ollama.title')}</h1>
                <p>{t('ollama.description')}</p>
            </Vetrina>
            <div className={stile.azioni}>
                <Bottone variante="contorno" onClick={riprova}>
                    {t('ollama.refresh')}
                </Bottone>
            </div>
            {stato.tipo === 'caricamento' ? (
                <StatoCaricamento testo={t('ollama.loading')} />
            ) : stato.tipo === 'errore' ? (
                <StatoErrore messaggio={t('ollama.loadError')} suRiprova={riprova} />
            ) : !stato.dati.length ? (
                <StatoVuoto
                    occhiello={t('adminEvents.source')}
                    titolo={t('ollama.empty')}
                    messaggio={t('ollama.description')}
                />
            ) : (
                <div className={stile.griglia}>
                    {stato.dati.map((e) => (
                        <article className={stile.carta} key={e.id}>
                            <h2>{e.titolo}</h2>
                            <p>
                                {e.dataEvento} · {e.luogo} · {e.citta}
                            </p>
                            <p>{e.artisti.map((a) => a.nome).join(', ')}</p>
                            <DatiValutazione v={e.valutazione} />
                            <div className={stile.azioni}>
                                <Link to={`/admin/eventi/${e.id}`}>{t('adminEvents.detail')}</Link>
                            </div>
                            <Rivaluta evento={e} aggiorna={riprova} />
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
export function DettaglioRevisioneEvento() {
    const { id } = useParams();
    const carica = useCallback(() => leggiRevisione(Number(id)), [id]);
    const { stato, riprova } = useRisorsa(`registro:${id}`, carica);
    return (
        <section className="pagina">
            <Link className={stile.ritorno} to="/admin/eventi">
                {t('ollama.back')}
            </Link>
            {stato.tipo === 'caricamento' ? (
                <StatoCaricamento testo={t('ollama.loading')} />
            ) : stato.tipo === 'errore' ? (
                <StatoErrore messaggio={t('ollama.loadError')} suRiprova={riprova} />
            ) : (
                <>
                    <Vetrina>
                        <div className="occhiello">{t('adminEvents.source')}</div>
                        <h1 className="titolo">{stato.dati.titolo}</h1>
                        <p>
                            {stato.dati.dataEvento} · {stato.dati.luogo} · {stato.dati.citta}
                        </p>
                        <p>{stato.dati.artisti.map((a) => a.nome).join(', ')}</p>
                    </Vetrina>
                    <div className={stile.carta}>
                        <DatiValutazione v={stato.dati.valutazione} />
                        <Rivaluta evento={stato.dati} aggiorna={riprova} />
                    </div>
                    <h2>{t('ollama.audit')}</h2>
                    {stato.dati.audit.map((a) => (
                        <article className={stile.carta} key={a.id}>
                            <h3>
                                {t('ollama.attempts')} {a.tentativo} · {a.modello} ·{' '}
                                {t('ollama.artist')} {a.artista_id ?? '—'}
                            </h3>
                            <p>
                                {a.versione_prompt} · {a.iniziato_at}
                            </p>
                            <p>
                                {a.decisione_applicata} · {a.motivazione ?? a.errore}
                            </p>
                            <details className={stile.snapshot}>
                                <summary>{t('ollama.raw')}</summary>
                                <pre>{a.risposta_raw ?? '—'}</pre>
                            </details>
                        </article>
                    ))}
                </>
            )}
        </section>
    );
}
