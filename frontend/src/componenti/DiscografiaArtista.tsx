import { useCallback, useState, type ReactNode } from 'react';
import { leggiDiscografia, type Discografia, type PubblicazioneDeezer } from '../api/discografia';
import { useRisorsa } from '../catalogo/useRisorsa';
import { dataCatalogo } from '../catalogo/formato';
import { t } from '../localizzazione/lingua';
import { Bottone } from './Bottone';
import { StatoCaricamento, StatoErrore } from './Stati';
import stile from './DiscografiaArtista.module.css';
function Carta({ dati, posizione }: { dati: PubblicazioneDeezer; posizione?: number }) {
    const [fallita, impostaFallita] = useState(false);
    const [logoFallito, impostaLogoFallito] = useState(false);
    return <article className={stile.carta}>
        <div className={stile.cover}>{dati.copertinaUrl && !fallita ?
            <img src={dati.copertinaUrl} alt={t('catalog.cover', { name: dati.titolo })} loading="lazy" referrerPolicy="no-referrer" onError={() => impostaFallita(true)} /> :
            <span aria-label={t('music.coverUnavailable')}>♫</span>}</div>
        <div className={stile.testi}>
            <small>{posizione ? `${String(posizione).padStart(2, '0')} · ${t('music.track')}` : t(`music.${dati.tipo ?? 'album'}`)}</small>
            <h3>{dati.titolo}</h3>
            {dati.dataPubblicazione ? <p>{dataCatalogo(dati.dataPubblicazione)}</p> : null}
            <a className={stile.deezer} href={dati.urlDeezer} target="_blank" rel="noopener noreferrer" aria-label={t('music.openDeezer', { name: dati.titolo })}>
                {!logoFallito ? <img src="/brand/deezer/listen-on-deezer.svg" alt="" onError={() => impostaLogoFallito(true)} /> : t('music.listenDeezer')}
            </a>
        </div>
    </article>;
}
function Risultati({ iniziale, id }: { iniziale: Discografia; id: number }) {
    const [dati, impostaDati] = useState(iniziale);
    const [occupato, impostaOccupato] = useState(false);
    const [errore, impostaErrore] = useState(false);
    async function altri() {
        if (occupato || dati.prossimoIndice === null) return;
        impostaOccupato(true); impostaErrore(false);
        try {
            const nuovo = await leggiDiscografia(id, dati.prossimoIndice);
            if (nuovo.externalId !== dati.externalId) { impostaErrore(true); return; }
            const ids = new Set(dati.pubblicazioni.map(a => a.externalId));
            impostaDati({ ...dati, prossimoIndice: nuovo.prossimoIndice,
                pubblicazioni: [...dati.pubblicazioni, ...nuovo.pubblicazioni.filter(a => !ids.has(a.externalId))] });
        } catch { impostaErrore(true); } finally { impostaOccupato(false); }
    }
    if (!dati.disponibile) return <p className="introduzione">{t('music.unavailable')}</p>;
    return <>
        <section className={stile.sezione} aria-label={t('music.popular')}>
            <div className="sezione"><h2>{t('music.popular')}</h2></div><p>{t('music.source')}</p>
            {dati.brani.length ? <div className={stile.brani}>{dati.brani.map((b, i) => <Carta key={b.externalId} dati={b} posizione={i + 1} />)}</div> : <p>{t('music.noTracks')}</p>}
        </section>
        <section className={stile.sezione} aria-label={t('music.releases')}>
            <div className="sezione"><h2>{t('music.releases')}</h2></div><p>{t('music.releaseIntro')}</p>
            {dati.pubblicazioni.length ? <div className={stile.album}>{dati.pubblicazioni.map(a => <Carta key={a.externalId} dati={a} />)}</div> : <p>{t('music.noReleases')}</p>}
            {errore ? <p role="alert">{t('music.error')}</p> : null}
            {dati.prossimoIndice !== null ? <Bottone variante="contorno" disabled={occupato} onClick={() => void altri()}>{t(occupato ? 'music.loading' : 'music.more')}</Bottone> : null}
        </section>
    </>;
}
export function DiscografiaArtista({ id, children }: { id: number; children?: ReactNode }) {
    const carica = useCallback(() => leggiDiscografia(id), [id]);
    const { stato, riprova } = useRisorsa(`discografia-${id}`, carica);
    return <>
        {stato.tipo === 'caricamento' ? <StatoCaricamento testo={t('music.loading')} /> :
            stato.tipo === 'errore' ? <StatoErrore messaggio={t('music.error')} suRiprova={riprova} /> : null}
        <div hidden={stato.tipo === 'pronto' && stato.dati.disponibile}>{children}</div>
        {stato.tipo === 'pronto' ? <Risultati key={`${id}:${stato.dati.externalId}`} id={id} iniziale={stato.dati} /> : null}
    </>;
}
