import { useCallback, useRef, useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router';
import { cercaProvider, collegaProvider, leggiGestioneProvider, sincronizzaProvider, ricontrollaTicketmaster, leggiProvider, nomeProvider, type GestioneArtistaProvider, type ProfiloProvider } from '../api/artistiProvider';
import { elencaArtisti, idDaPercorso } from '../api/catalogo';
import { ErroreApi } from '../api/client';
import { useRisorsa, type StatoRisorsa } from '../catalogo/useRisorsa';
import { dataControllo } from '../catalogo/formato';
import { Avviso } from '../componenti/Avviso';
import { Bottone, BottoneLink } from '../componenti/Bottone';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import { t, locale, type Chiave } from '../localizzazione/lingua';
import stile from './AdminArtisti.module.css';

const ERRORI: Record<string, Chiave> = {
    APPLE_CONFIGURAZIONE: 'apple.error.config', APPLE_NON_TROVATO: 'apple.error.missing',
    ARTISTA_NON_TROVATO: 'apple.error.artistMissing', APPLE_LINK_ASSENTE: 'apple.error.noLink',
    APPLE_CONFLITTO: 'apple.error.conflict', APPLE_GIA_COLLEGATO: 'apple.error.duplicate',
    APPLE_AUTORIZZAZIONE: 'apple.error.authorization', APPLE_LIMITE: 'apple.error.limit',
    APPLE_TIMEOUT: 'apple.error.timeout', APPLE_DATI_INVALIDI: 'apple.error.payload',
    APPLE_PARAMETRI: 'common.invalidData',
    PROVIDER_CONFIGURAZIONE: 'provider.error.config', DEEZER_CONFIGURAZIONE: 'provider.error.config',
    DEEZER_NON_TROVATO: 'provider.error.missing', DEEZER_LINK_ASSENTE: 'provider.error.noLink',
    DEEZER_CONFLITTO: 'apple.error.conflict', DEEZER_GIA_COLLEGATO: 'provider.error.duplicate',
    DEEZER_LIMITE: 'provider.error.limit', DEEZER_TIMEOUT: 'provider.error.timeout', DEEZER_PARAMETRI: 'common.invalidData',
    DEEZER_DATI_INVALIDI: 'provider.error.payload',
};
function errore(causa: unknown): string {
    if (causa instanceof ErroreApi) {
        if (causa.stato === 401) return t('adminEvents.expired');
        if (causa.stato === 403) return t('adminEvents.denied');
        if (causa.codice && ERRORI[causa.codice]) return t(ERRORI[causa.codice]!);
        if (causa.stato === 404) return t('apple.error.artistMissing');
    }
    return t('provider.error.server');
}
function Profilo({ dati }: { dati: ProfiloProvider }) {
    const [rotta, impostaRotta] = useState(false);
    return <div className={stile.profilo}>
        {dati.artwork && !rotta ? <img className={stile.immagine} src={dati.artwork.url} alt={t('catalog.photo', { name: dati.name })}
            loading="lazy" referrerPolicy="no-referrer" onError={() => impostaRotta(true)} /> :
            <span className={stile.placeholder} aria-label={t('provider.noArtwork')}>{dati.name.slice(0, 1).toLocaleUpperCase()}</span>}
        <div className={stile.testi}><h3>{dati.name}</h3>{dati.genres.length ? <p>{dati.genres.join(' · ')}</p> : null}{dati.fan !== null ? <p>{t('provider.fans', { count: dati.fan.toLocaleString(locale()) })}</p> : null}
            <p>{t('provider.identity', { id: dati.externalId, provider: nomeProvider(dati.provider) })}{dati.storefront ? ` · ${dati.storefront.toUpperCase()}` : ''}</p>
            <a href={dati.url} target="_blank" rel="noopener noreferrer">{t('provider.open', { provider: nomeProvider(dati.provider) })}</a></div>
    </div>;
}
export function AdminArtisti() {
    const carica = useCallback(async () => ({ artisti: await elencaArtisti(), provider: await leggiProvider() }), []);
    const { stato, riprova } = useRisorsa('admin-artisti', carica);
    return <div className={stile.pagina}><Vetrina><div className="occhiello">{t('provider.eyebrow')}</div>
        <h1 className="titolo">{t('provider.title')}</h1><p>{t('provider.intro')}</p></Vetrina>
        {stato.tipo === 'caricamento' ? <StatoCaricamento testo={t('provider.loadingArtists')} /> :
            stato.tipo === 'errore' ? <StatoErrore titolo={t('provider.title')} messaggio={errore(stato.causa)} suRiprova={riprova} /> :
            stato.dati.artisti.length === 0 ? <StatoVuoto occhiello={t('provider.eyebrow')} titolo={t('provider.noLocalArtists')} messaggio={t('provider.localOnly')} /> :
            <><p>{t('provider.active', { provider: nomeProvider(stato.dati.provider) })}</p><ul className={stile.artisti}>{stato.dati.artisti.map(a => <li key={a.id}><Link to={`/admin/artisti/${a.id}`}>{a.nome} ↗</Link></li>)}</ul></>}
    </div>;
}
export function DettaglioAdminArtista() {
    const { id: parametro } = useParams();
    const id = idDaPercorso(parametro);
    const carica = useCallback(() => leggiGestioneProvider(id ?? 0), [id]);
    const { stato, riprova } = useRisorsa(`admin-artista-${id}`, carica);
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo={t('provider.loadingArtist')} />;
    if (stato.tipo === 'errore') return <StatoErrore titolo={t('provider.title')} messaggio={errore(stato.causa)} suRiprova={riprova} />;
    return <EditorProvider key={id} iniziale={stato.dati} />;
}
function EditorProvider({ iniziale }: { iniziale: GestioneArtistaProvider }) {
    const { artista, provider } = iniziale;
    const [link, impostaLink] = useState(iniziale.collegamento);
    const [query, impostaQuery] = useState(artista.nome);
    const [ricerca, impostaRicerca] = useState<StatoRisorsa<ProfiloProvider[]> | null>(null);
    const [scelto, impostaScelto] = useState<ProfiloProvider | null>(null);
    const [conferma, impostaConferma] = useState(false);
    const [occupato, impostaOccupato] = useState(false);
    const [fallimento, impostaFallimento] = useState<unknown>(null);
    const [successo, impostaSuccesso] = useState<Chiave | null>(null);
    const tentativo = useRef(0);
    async function cerca(e: SubmitEvent) {
        e.preventDefault();
        const n = ++tentativo.current;
        impostaRicerca({ tipo: 'caricamento' }); impostaScelto(null); impostaConferma(false);
        impostaFallimento(null); impostaSuccesso(null);
        try {
            const risultati = await cercaProvider(artista.id, provider, query.trim());
            if (tentativo.current === n) impostaRicerca({ tipo: 'pronto', dati: risultati });
        } catch (causa) { if (tentativo.current === n) impostaRicerca({ tipo: 'errore', causa }); }
    }
    async function salva(sync: boolean) {
        if (occupato) return;
        impostaOccupato(true); impostaFallimento(null); impostaSuccesso(null);
        try {
            const nuovo = sync && link ? await sincronizzaProvider(artista.id, provider, link.versione) :
                await collegaProvider(artista.id, provider, scelto!.externalId, link?.versione ?? null);
            impostaLink(nuovo); impostaSuccesso(sync ? 'provider.synced' : 'provider.linked');
            impostaScelto(null); impostaConferma(false);
        } catch (causa) { impostaFallimento(causa); }
        finally { impostaOccupato(false); }
    }
    async function ricontrolla() {
        if (occupato || !link) return;
        impostaOccupato(true); impostaFallimento(null); impostaSuccesso(null);
        try {
            impostaLink(await ricontrollaTicketmaster(artista.id, provider, link.versione));
            impostaSuccesso('provider.tm.checked');
        } catch (causa) { impostaFallimento(causa); }
        finally { impostaOccupato(false); }
    }
    async function ricarica() {
        impostaOccupato(true);
        try {
            const aggiornato = await leggiGestioneProvider(artista.id);
            impostaLink(aggiornato.collegamento); impostaFallimento(null);
            impostaConferma(false); impostaScelto(null);
        } catch (causa) { impostaFallimento(causa); }
        finally { impostaOccupato(false); }
    }
    return <div className={stile.pagina}>
        <Link to="/admin/artisti">{t('provider.back')}</Link>
        <Vetrina><div className="occhiello">{t('provider.eyebrow')}</div><h1 className="titolo">{artista.nome}</h1><p>{t('provider.intro')}</p><p>{t('provider.active', { provider: nomeProvider(provider) })}</p></Vetrina>
        <section className={stile.pannello} aria-label={t('provider.current')}><h2>{t('provider.current')}</h2>
            {link ? <><Profilo key={link.artwork?.url ?? link.externalId} dati={link} /><p>{t('provider.lastSync', { date: dataControllo(link.syncedAt) })}</p>
                <Bottone variante="contorno" disabled={occupato || conferma || ricerca?.tipo === 'caricamento'} onClick={() => void salva(true)}>{occupato ? t('provider.saving') : t('provider.sync')}</Bottone>
                <div className={stile.presenza}><strong>{t(link.ticketmaster.stato === 'trovato' ? 'provider.tm.found' : link.ticketmaster.stato === 'non_trovato' ? 'provider.tm.missing' : 'provider.tm.failed')}</strong>
                    <p>{t('provider.tm.note')}</p>
                    {link.ticketmaster.ambiguo ? <Avviso>{t('provider.tm.ambiguous')}</Avviso> : null}
                    {link.ticketmaster.attractions.length ? <ul>{link.ticketmaster.attractions.map(a => <li key={a.id}>{a.name} · {a.id}</li>)}</ul> : null}
                    {link.ticketmaster.controllatoAt ? <p>{t('provider.tm.date', { date: dataControllo(link.ticketmaster.controllatoAt) })}</p> : null}
                    <Bottone variante="contorno" disabled={occupato || conferma || ricerca?.tipo === 'caricamento'} onClick={() => void ricontrolla()}>{t('provider.tm.retry')}</Bottone>
                </div></> : <p>{t('provider.noLink')}</p>}
        </section>
        {fallimento !== null ? <Avviso tipo="errore">{errore(fallimento)} <Bottone variante="contorno" disabled={occupato} onClick={() => void ricarica()}>{t('provider.reload')}</Bottone></Avviso> : null}
        {successo ? <Avviso tipo="successo">{t(successo)}</Avviso> : null}
        <section className={stile.pannello} aria-label={t('provider.searchTitle')}><h2>{t('provider.searchTitle')}</h2>
            <form onSubmit={e => void cerca(e)} className={stile.ricerca}>
                <label htmlFor="provider-query">{t('provider.query')}</label>
                <input id="provider-query" value={query} onChange={e => impostaQuery(e.target.value)} required maxLength={200} disabled={occupato || conferma} placeholder={t('provider.queryPlaceholder')} />
                <Bottone type="submit" disabled={occupato || conferma || !query.trim() || ricerca?.tipo === 'caricamento'}>{t('provider.search')}</Bottone>
            </form>
            {ricerca?.tipo === 'caricamento' ? <StatoCaricamento testo={t('provider.searching')} /> : null}
            {ricerca?.tipo === 'errore' ? <Avviso tipo="errore">{errore(ricerca.causa)}</Avviso> : null}
            {ricerca?.tipo === 'pronto' && ricerca.dati.length === 0 ? <Avviso>{t('provider.empty')}</Avviso> : null}
            {ricerca?.tipo === 'pronto' && ricerca.dati.length > 0 ? <fieldset className={stile.risultati} disabled={occupato || conferma}>
                <legend>{t('provider.select')}</legend>{ricerca.dati.map(r => <article key={r.externalId} className={stile.risultato}>
                    <Profilo dati={r} /><label><input type="radio" name="provider-result" checked={scelto?.externalId === r.externalId} onChange={() => impostaScelto(r)} />{t('provider.choose', { name: r.name })}</label>
                    {link?.externalId === r.externalId && link.storefront === r.storefront ? <strong>{t('provider.currentBadge')}</strong> : null}
                </article>)}</fieldset> : null}
            {scelto ? <Bottone disabled={occupato || conferma} onClick={() => impostaConferma(true)}>{t('provider.review')}</Bottone> : null}
        </section>
        {conferma && scelto ? <section className={stile.pannello} aria-label={t('provider.confirmTitle')}>
            <h2>{t('provider.confirmTitle')}</h2><p>{t(link ? 'provider.replaceWarning' : 'provider.confirmWarning', { local: artista.nome, artist: scelto.name })}</p>
            <div className={stile.azioni}><Bottone disabled={occupato} onClick={() => void salva(false)}>{occupato ? t('provider.saving') : t('provider.confirm')}</Bottone>
                <Bottone variante="contorno" disabled={occupato} onClick={() => impostaConferma(false)}>{t('provider.cancel')}</Bottone></div>
        </section> : null}
        <BottoneLink variante="contorno" to={`/artisti/${artista.id}`}>{t('provider.localDetail')}</BottoneLink>
    </div>;
}
