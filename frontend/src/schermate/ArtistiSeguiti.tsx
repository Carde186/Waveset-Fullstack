import { useRef, useState } from 'react';
import { elencaArtistiSeguiti, impostaFollowArtista, type ArtistaSintetico } from '../api/catalogo';
import { ErroreApi } from '../api/client';
import { useAutenticazione } from '../autenticazione/contesto';
import { erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Avviso } from '../componenti/Avviso';
import { Bottone, BottoneLink } from '../componenti/Bottone';
import { CartaArtista } from '../componenti/Catalogo';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { t } from '../localizzazione/lingua';
import stile from './ArtistiSeguiti.module.css';

function ElencoSeguiti({ artisti }: { artisti: ArtistaSintetico[] }) {
    const { riprova } = useAutenticazione();
    const [rimossi, impostaRimossi] = useState<Set<number>>(new Set());
    const [occupati, impostaOccupati] = useState<Set<number>>(new Set());
    const [errori, impostaErrori] = useState<Set<number>>(new Set());
    const [ultimo, impostaUltimo] = useState<string | null>(null);
    const blocco = useRef(new Set<number>());
    const visibili = artisti.filter(a => !rimossi.has(a.id));
    async function smetti(artista: ArtistaSintetico) {
        if (blocco.current.has(artista.id)) return;
        blocco.current.add(artista.id);
        impostaOccupati(new Set(blocco.current));
        impostaErrori(correnti => { const nuovi = new Set(correnti); nuovi.delete(artista.id); return nuovi; });
        try {
            await impostaFollowArtista(artista.id, false);
            impostaRimossi(correnti => new Set([...correnti, artista.id]));
            impostaUltimo(artista.nome);
        } catch (causa) {
            impostaErrori(correnti => new Set([...correnti, artista.id]));
            if (causa instanceof ErroreApi && causa.stato === 401) await riprova();
        } finally {
            blocco.current.delete(artista.id);
            impostaOccupati(new Set(blocco.current));
        }
    }
    return <>
        <p role="status" aria-live="polite">{t('follow.count', { count: visibili.length })}{ultimo ? ` · ${t('follow.removed', { name: ultimo })}` : ''}</p>
        {visibili.length ? <ul className={stile.lista} aria-label={t('follow.pageTitle')}>
            {visibili.map(artista => <li key={artista.id}>
                <CartaArtista artista={artista} />
                <div className={stile.azioni}>
                    <Bottone variante="contorno" disabled={occupati.has(artista.id)} aria-label={t('follow.unfollowNamed', { name: artista.nome })} onClick={() => void smetti(artista)}>
                        {t(occupati.has(artista.id) ? 'follow.pending' : 'follow.unfollow')}
                    </Bottone>
                    {errori.has(artista.id) ? <Avviso tipo="errore">{t('follow.error')}</Avviso> : null}
                </div>
            </li>)}
        </ul> : <StatoVuoto occhiello={t('follow.pageTitle')} titolo={t('follow.emptyTitle')} messaggio={t('follow.emptyMessage')}
            azione={{ testo: t('text.explore'), verso: '/esplora' }} livelloTitolo={2} />}
    </>;
}
function ListaSeguiti({ utenteId }: { utenteId: number }) {
    const { riprova: controllaSessione } = useAutenticazione();
    const { stato, riprova } = useRisorsa(`artisti-seguiti:${utenteId}`, elencaArtistiSeguiti);
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo={t('follow.loading')} livelloTitolo={2} />;
    if (stato.tipo === 'errore') return <StatoErrore titolo={t('follow.listError')}
        messaggio={stato.causa instanceof ErroreApi && stato.causa.stato === 401
            ? <Bottone onClick={() => void controllaSessione()}>{t('text.checkYourSession')}</Bottone> : erroreCatalogo(stato.causa)}
        suRiprova={riprova} livelloTitolo={2} />;
    return <ElencoSeguiti artisti={stato.dati} />;
}
export function ArtistiSeguiti() {
    const { stato } = useAutenticazione();
    if (stato.tipo !== 'autenticato') return null;
    if (stato.utente.ruolo !== 'USER') return <StatoVuoto occhiello="403" titolo={t('follow.onlyUsers')} messaggio={t('follow.onlyUsersMessage')} />;
    return <section className="pagina">
        <Vetrina>
            <div className="occhiello">{t('follow.yourMusic')}</div>
            <h1 className="titolo-medio">{t('follow.pageTitle')}</h1>
            <p>{t('follow.pageIntro')}</p>
            <BottoneLink to="/eventi?filtro=seguiti">{t('follow.viewEvents')}</BottoneLink>
        </Vetrina>
        <div className="sezione"><h2>{t('follow.yourArtists')}</h2></div>
        <ListaSeguiti key={stato.utente.id} utenteId={stato.utente.id} />
    </section>;
}
