import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router';
import {
    confermaCollegamento,
    decidiEvento,
    elencaCoda,
    leggiFonte,
    leggiRevisione,
    type ArtistaRevisione,
    type EventoRevisione,
    type FonteRevisione,
} from '../api/adminEventi';
import { ErroreApi } from '../api/client';
import { idEventoDaPercorso } from '../api/eventi';
import { dataCatalogo, dataControllo, erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Avviso } from '../componenti/Avviso';
import { Bottone, BottoneLink } from '../componenti/Bottone';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { t, type Chiave } from '../localizzazione/lingua';
import stile from './AdminEventi.module.css';

const STATI: Record<EventoRevisione['stato'], Chiave> = {
    in_coda: 'adminEvents.pending',
    pubblicato: 'adminEvents.approved',
    scartato: 'adminEvents.rejected',
};
const STATI_FONTE: Record<string, Chiave> = {
    onsale: 'adminEvents.onsale',
    offsale: 'adminEvents.offsale',
    canceled: 'adminEvents.canceled',
    postponed: 'adminEvents.postponed',
    rescheduled: 'adminEvents.rescheduled',
};
const MOTIVI: Record<string, Chiave> = {
    lineup_non_confermato: 'adminEvents.reason.lineup_non_confermato',
    possibile_doppione: 'adminEvents.reason.possibile_doppione',
    coordinate_irrecuperabili: 'adminEvents.reason.coordinate_irrecuperabili',
    data_incerta: 'adminEvents.reason.data_incerta',
};
function erroreRevisione(causa: unknown): string {
    if (causa instanceof ErroreApi) {
        if (causa.stato === 401) return t('adminEvents.expired');
        if (causa.stato === 403) return t('adminEvents.denied');
        if (causa.stato === 404) return t('adminEvents.missing');
        if (causa.stato === 409) return t('adminEvents.conflict');
        if (
            causa.stato === 400 &&
            causa.messaggioServer === 'Imposta le coordinate prima di approvare'
        )
            return t('adminEvents.coordinatesRequired');
        if (causa.stato === 400 && causa.messaggioServer === 'Evento annullato dalla fonte')
            return t('adminEvents.canceledError');
        if (causa.stato === 400) return t('common.invalidData');
    }
    return erroreCatalogo(causa);
}
function Motivo({ evento }: { evento: EventoRevisione }) {
    if (!evento.motivo) return null;
    // Le motivazioni dello scheduler sono codici; uno scarto può contenere testo ADMIN.
    const testo =
        evento.stato === 'scartato'
            ? evento.motivo
            : evento.motivo
                  .split(/[;,]\s*/)
                  .map((v) => (MOTIVI[v.trim()] ? t(MOTIVI[v.trim()]!) : v.trim()))
                  .join(' · ');
    return (
        <p>
            {t('adminEvents.reason')}: {testo}
        </p>
    );
}
function DatiEvento({ evento }: { evento: EventoRevisione }) {
    return (
        <dl className={stile.dati}>
            <div>
                <dt>{t('adminEvents.date')}</dt>
                <dd>
                    {dataCatalogo(evento.dataEvento)} ·{' '}
                    {evento.oraEvento?.slice(0, 5) ?? t('adminEvents.unknown')}
                </dd>
            </div>
            <div>
                <dt>{t('adminEvents.venue')}</dt>
                <dd>
                    {[evento.luogo, evento.citta].filter(Boolean).join(' · ') ||
                        t('adminEvents.unknown')}
                </dd>
            </div>
            <div>
                <dt>{t('adminEvents.coordinates')}</dt>
                <dd>
                    {evento.coordinate
                        ? `${evento.coordinate.lat}, ${evento.coordinate.lng}`
                        : t('adminEvents.unknown')}
                </dd>
            </div>
        </dl>
    );
}

type Decisione =
    | { tipo: 'collega'; evento: EventoRevisione; artista: ArtistaRevisione }
    | { tipo: 'approva' | 'scarta'; evento: EventoRevisione };
function useDecisione(aggiorna: () => void) {
    const [selezione, impostaSelezione] = useState<Decisione | null>(null);
    const [occupato, impostaOccupato] = useState(false);
    const blocco = useRef(false);
    const [errore, impostaErrore] = useState<unknown>(null);
    const [successo, impostaSuccesso] = useState<Chiave | null>(null);
    function scegli(decisione: Decisione) {
        if (blocco.current) return;
        impostaErrore(null);
        impostaSuccesso(null);
        impostaSelezione(decisione);
    }
    async function conferma(motivo: string) {
        if (!selezione || blocco.current) return;
        blocco.current = true;
        impostaOccupato(true);
        impostaErrore(null);
        try {
            if (selezione.tipo === 'collega')
                await confermaCollegamento(selezione.evento.id, selezione.artista.id);
            else await decidiEvento(selezione.evento.id, selezione.tipo, motivo);
            impostaSuccesso(
                selezione.tipo === 'collega'
                    ? 'adminEvents.linkSuccess'
                    : selezione.tipo === 'approva'
                      ? 'adminEvents.approveSuccess'
                      : 'adminEvents.rejectSuccess',
            );
            impostaSelezione(null);
            aggiorna();
        } catch (causa) {
            impostaErrore(causa);
        } finally {
            blocco.current = false;
            impostaOccupato(false);
        }
    }
    return {
        selezione,
        occupato,
        errore,
        successo,
        scegli,
        conferma,
        annulla: () => {
            if (!blocco.current) impostaSelezione(null);
        },
    };
}
type GestioneDecisione = ReturnType<typeof useDecisione>;
function DialogoDecisione({ gestione }: { gestione: GestioneDecisione }) {
    const ref = useRef<HTMLDialogElement>(null);
    const titoloId = useId();
    const descrizioneId = useId();
    const motivoId = useId();
    const [motivo, impostaMotivo] = useState('');
    useEffect(() => {
        const dialogo = ref.current;
        const precedente = document.activeElement;
        if (dialogo && !dialogo.open) {
            if (typeof dialogo.showModal === 'function') dialogo.showModal();
            else dialogo.setAttribute('open', ''); // Ambienti DOM dei test.
        }
        return () => {
            dialogo?.close?.();
            if (precedente instanceof HTMLElement && precedente.isConnected) precedente.focus();
        };
    }, []);
    const decisione = gestione.selezione;
    if (!decisione) return null;
    const titolo =
        decisione.tipo === 'collega'
            ? t('adminEvents.confirmLinkTitle', { artist: decisione.artista.nome })
            : t(
                  decisione.tipo === 'approva'
                      ? 'adminEvents.approveTitle'
                      : 'adminEvents.rejectTitle',
                  { title: decisione.evento.titolo },
              );
    const descrizione =
        decisione.tipo === 'collega'
            ? t('adminEvents.confirmLinkBody', {
                  id: decisione.artista.candidato ?? t('adminEvents.unknown'),
              })
            : t(
                  decisione.tipo === 'approva'
                      ? 'adminEvents.approveBody'
                      : 'adminEvents.rejectBody',
              );
    function invia(e: SubmitEvent<HTMLFormElement>) {
        e.preventDefault();
        void gestione.conferma(motivo);
    }
    return (
        <dialog
            ref={ref}
            className={stile.dialogo}
            aria-labelledby={titoloId}
            aria-describedby={descrizioneId}
            onCancel={(e) => {
                e.preventDefault();
                gestione.annulla();
            }}
        >
            <form onSubmit={invia} aria-busy={gestione.occupato}>
                <h2 id={titoloId}>{titolo}</h2>
                <p id={descrizioneId}>{descrizione}</p>
                {decisione.tipo === 'scarta' ? (
                    <>
                        <label htmlFor={motivoId}>{t('adminEvents.rejectReason')}</label>
                        <textarea
                            id={motivoId}
                            maxLength={255}
                            value={motivo}
                            onChange={(e) => impostaMotivo(e.target.value)}
                            disabled={gestione.occupato}
                        />
                    </>
                ) : null}
                {gestione.errore ? (
                    <Avviso tipo="errore">{erroreRevisione(gestione.errore)}</Avviso>
                ) : null}
                <div className={stile.azioni}>
                    <Bottone
                        variante="contorno"
                        onClick={gestione.annulla}
                        disabled={gestione.occupato}
                    >
                        {t('adminEvents.cancel')}
                    </Bottone>
                    <Bottone type="submit" disabled={gestione.occupato}>
                        {t(gestione.occupato ? 'adminEvents.working' : 'adminEvents.confirm')}
                    </Bottone>
                </div>
            </form>
        </dialog>
    );
}
function AzioniEvento({
    evento,
    gestione,
    annullato = false,
}: {
    evento: EventoRevisione;
    gestione: GestioneDecisione;
    annullato?: boolean;
}) {
    if (evento.stato !== 'in_coda') return null;
    return (
        <div className={stile.azioni}>
            <Bottone
                disabled={gestione.occupato || !evento.coordinate || annullato}
                onClick={() => gestione.scegli({ tipo: 'approva', evento })}
            >
                {t('adminEvents.approve')}
            </Bottone>
            <Bottone
                variante="contorno"
                disabled={gestione.occupato}
                onClick={() => gestione.scegli({ tipo: 'scarta', evento })}
            >
                {t('adminEvents.reject')}
            </Bottone>
            {!evento.coordinate ? <p>{t('adminEvents.coordinatesRequired')}</p> : null}
            {annullato ? <p>{t('adminEvents.canceledError')}</p> : null}
        </div>
    );
}
function AvvisoDecisione({ gestione }: { gestione: GestioneDecisione }) {
    return gestione.successo ? <Avviso tipo="successo">{t(gestione.successo)}</Avviso> : null;
}
export function AdminEventi() {
    const { stato, riprova } = useRisorsa('admin:coda', elencaCoda);
    const gestione = useDecisione(riprova);
    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">{t('adminEvents.source')}</div>
                <h1 className="titolo">{t('adminEvents.title')}</h1>
                <p className="introduzione">{t('adminEvents.intro')}</p>
            </Vetrina>
            <AvvisoDecisione gestione={gestione} />
            {stato.tipo === 'caricamento' ? (
                <StatoCaricamento testo={t('adminEvents.loading')} livelloTitolo={2} />
            ) : stato.tipo === 'errore' ? (
                <StatoErrore
                    titolo={t('adminEvents.loadError')}
                    messaggio={erroreRevisione(stato.causa)}
                    suRiprova={riprova}
                    livelloTitolo={2}
                />
            ) : (
                <>
                    <div className={stile.azioni}>
                        <p>{t('adminEvents.count', { count: stato.dati.length })}</p>
                        <Bottone variante="contorno" disabled={gestione.occupato} onClick={riprova}>
                            {t('adminEvents.refresh')}
                        </Bottone>
                    </div>
                    {stato.dati.length === 0 ? (
                        <StatoVuoto
                            occhiello={t('adminEvents.source')}
                            titolo={t('adminEvents.empty')}
                            messaggio={t('adminEvents.emptyBody')}
                            livelloTitolo={2}
                        />
                    ) : (
                        <div className={stile.griglia}>
                            {stato.dati.map((evento) => (
                                <article
                                    key={evento.id}
                                    className={stile.carta}
                                    aria-labelledby={`evento-${evento.id}`}
                                >
                                    <span className={stile.stato}>{t(STATI[evento.stato])}</span>
                                    <h2 id={`evento-${evento.id}`}>{evento.titolo}</h2>
                                    <DatiEvento evento={evento} />
                                    <p>
                                        {evento.artisti.map((a) => a.nome).join(' · ') ||
                                            t('adminEvents.noArtists')}
                                    </p>
                                    {evento.artisti.length > 0 ? (
                                        <span className={stile.stato}>
                                            {t(
                                                evento.artisti.every(
                                                    (a) => !!a.candidato && !a.daConfermare,
                                                )
                                                    ? 'adminEvents.confirmed'
                                                    : 'adminEvents.unconfirmed',
                                            )}
                                        </span>
                                    ) : null}
                                    <Motivo evento={evento} />
                                    <div className={stile.azioni}>
                                        <BottoneLink
                                            to={`/admin/eventi/${evento.id}`}
                                            variante="contorno"
                                        >
                                            {t('adminEvents.detail')}
                                        </BottoneLink>
                                    </div>
                                    <AzioniEvento evento={evento} gestione={gestione} />
                                </article>
                            ))}
                        </div>
                    )}
                </>
            )}
            {gestione.selezione ? <DialogoDecisione gestione={gestione} /> : null}
        </section>
    );
}

function ArtistaDaRevisionare({
    artista,
    evento,
    fonte,
    gestione,
}: {
    artista: ArtistaRevisione;
    evento: EventoRevisione;
    fonte: FonteRevisione | null;
    gestione: GestioneDecisione;
}) {
    const attraction = fonte?.attractions.find((a) => a.id === artista.candidato);
    return (
        <article className={stile.artista}>
            <h3>
                <Link to={`/artisti/${artista.id}`}>{artista.nome}</Link>
            </h3>
            <p>{t('adminEvents.localArtist', { id: artista.id })}</p>
            <dl className={stile.dati}>
                <div>
                    <dt>{t('adminEvents.attraction')}</dt>
                    <dd>
                        {attraction?.nome ?? t('adminEvents.unknown')} ·{' '}
                        {artista.candidato ?? t('adminEvents.unknown')}
                    </dd>
                </div>
                <div>
                    <dt>{t('adminEvents.confirmedId')}</dt>
                    <dd>{artista.confermato ?? t('adminEvents.unknown')}</dd>
                </div>
            </dl>
            {attraction?.url ? (
                <p>
                    <a href={attraction.url} target="_blank" rel="noopener noreferrer">
                        {t('adminEvents.openSource')}
                    </a>
                </p>
            ) : null}
            {!attraction ? <p>{t('adminEvents.oldSnapshot')}</p> : null}
            <span className={stile.stato}>
                {t(
                    !artista.candidato
                        ? 'adminEvents.noCandidate'
                        : artista.daConfermare
                          ? 'adminEvents.unconfirmed'
                          : 'adminEvents.confirmed',
                )}
            </span>
            {artista.candidato && artista.daConfermare && evento.stato === 'in_coda' ? (
                <div className={stile.azioni}>
                    <Bottone
                        variante="contorno"
                        disabled={gestione.occupato}
                        onClick={() => gestione.scegli({ tipo: 'collega', evento, artista })}
                    >
                        {t('adminEvents.confirmLink')}
                    </Bottone>
                </div>
            ) : null}
        </article>
    );
}
function RevisioneEvento({ id }: { id: number | null }) {
    const carica = useCallback(async () => {
        if (id === null) throw new ErroreApi(400);
        const [evento, fonte] = await Promise.all([leggiRevisione(id), leggiFonte(id)]);
        return { evento, fonte };
    }, [id]);
    const { stato, riprova } = useRisorsa(`admin:evento:${id}`, carica);
    const gestione = useDecisione(riprova);
    return (
        <section className="pagina">
            <Link className={stile.ritorno} to="/admin/eventi">
                {t('adminEvents.back')}
            </Link>
            <AvvisoDecisione gestione={gestione} />
            {stato.tipo === 'caricamento' ? (
                <StatoCaricamento testo={t('adminEvents.loading')} />
            ) : stato.tipo === 'errore' ? (
                <StatoErrore
                    titolo={t('adminEvents.loadError')}
                    messaggio={erroreRevisione(stato.causa)}
                    suRiprova={riprova}
                />
            ) : (
                <>
                    <Vetrina>
                        <div className="occhiello">{t('adminEvents.source')}</div>
                        <h1 className="titolo">{stato.dati.evento.titolo}</h1>
                        <span className={stile.stato}>{t(STATI[stato.dati.evento.stato])}</span>
                        <Motivo evento={stato.dati.evento} />
                    </Vetrina>
                    <div className={stile.dettaglio}>
                        <section className={stile.carta}>
                            <h2>{t('adminEvents.eventData')}</h2>
                            <DatiEvento evento={stato.dati.evento} />
                            <AzioniEvento
                                evento={stato.dati.evento}
                                gestione={gestione}
                                annullato={stato.dati.fonte?.stato === 'canceled'}
                            />
                            {stato.dati.evento.stato === 'pubblicato' ? (
                                <p>
                                    <Link to={`/eventi/${stato.dati.evento.id}`}>
                                        {t('adminEvents.publicLink')}
                                    </Link>
                                </p>
                            ) : null}
                        </section>
                        <section className={stile.carta}>
                            <h2>{t('adminEvents.artists')}</h2>
                            {stato.dati.evento.artisti.length === 0 ? (
                                <p>{t('adminEvents.noArtists')}</p>
                            ) : (
                                stato.dati.evento.artisti.map((artista) => (
                                    <ArtistaDaRevisionare
                                        key={artista.id}
                                        artista={artista}
                                        evento={stato.dati.evento}
                                        fonte={stato.dati.fonte}
                                        gestione={gestione}
                                    />
                                ))
                            )}
                        </section>
                        <section className={`${stile.carta} ${stile.snapshot}`}>
                            <h2>{t('adminEvents.snapshot')}</h2>
                            <p>{t('adminEvents.snapshotInfo')}</p>
                            {stato.dati.fonte ? (
                                <>
                                    <p>
                                        {t('adminEvents.checked')}:{' '}
                                        {dataControllo(stato.dati.fonte.ultimoControllo)}
                                    </p>
                                    <p>
                                        {t('adminEvents.sourceState')}:{' '}
                                        {t(
                                            STATI_FONTE[stato.dati.fonte.stato] ??
                                                'adminEvents.unknown',
                                        )}
                                    </p>
                                    {stato.dati.fonte.protetto ? (
                                        <p>{t('adminEvents.protected')}</p>
                                    ) : null}
                                    {stato.dati.fonte.modifiche ? (
                                        <Avviso>{t('sync.changes')}</Avviso>
                                    ) : null}
                                    {stato.dati.fonte.assenteDal ? (
                                        <Avviso>{t('sync.missing')}</Avviso>
                                    ) : null}
                                    <details>
                                        <summary>{t('adminEvents.snapshot')}</summary>
                                        <pre>
                                            {JSON.stringify(stato.dati.fonte.snapshot, null, 2)}
                                        </pre>
                                    </details>
                                </>
                            ) : (
                                <Avviso>{t('adminEvents.noSnapshot')}</Avviso>
                            )}
                        </section>
                    </div>
                </>
            )}
            {gestione.selezione ? <DialogoDecisione gestione={gestione} /> : null}
        </section>
    );
}
export function DettaglioRevisioneEvento() {
    const { id: parametro } = useParams();
    const id = idEventoDaPercorso(parametro);
    return <RevisioneEvento key={parametro} id={id} />;
}
