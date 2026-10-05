import { locale, t, useLingua } from '../localizzazione/lingua';
import { useCallback, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
    idDaPercorso,
    leggiAlbum,
    leggiArtista,
    leggiBrano,
    leggiLinkSpotify,
} from '../api/catalogo';
import { ErroreApi } from '../api/client';
import { useAutenticazione } from '../autenticazione/contesto';
import { DiscografiaArtista } from '../componenti/DiscografiaArtista';
import { FollowArtista } from '../componenti/FollowArtista';
import { dataCatalogo, erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Avviso } from '../componenti/Avviso';
import { Bottone, BottoneLink } from '../componenti/Bottone';
import { ArteCatalogo, CartaAlbum, ListaBrani } from '../componenti/Catalogo';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import stile from './Catalogo.module.css';

function PaginaDettaglio<T>({
    tipo,
    carica,
    children,
}: {
    tipo: 'artista' | 'brano' | 'album';
    carica: (id: number) => Promise<T>;
    children: (dati: T) => ReactNode;
}) {
    const { id: parametro } = useParams();
    const id = idDaPercorso(parametro);
    const { stato: sessione } = useAutenticazione();
    const identita = tipo === 'artista' ? (sessione.tipo === 'autenticato' ? sessione.utente.id : sessione.tipo) : '';
    const richiesta = useCallback(
        () => (id === null ? Promise.reject(new ErroreApi(404)) : carica(id)),
        [id, carica],
    );
    const { stato, riprova } = useRisorsa(`${tipo}:${parametro}:${identita}`, richiesta);
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo={t('text.loadingDetails')} />;
    if (stato.tipo === 'errore') {
        if (stato.causa instanceof ErroreApi && stato.causa.stato === 404)
            return (
                <StatoVuoto
                    occhiello="404"
                    titolo={t(tipo === 'artista' ? 'catalog.artistMissing' : tipo === 'brano' ? 'catalog.trackMissing' : 'catalog.albumMissing')}
                    messaggio={t('text.thisItemIsNotInThe')}
                    azione={{ testo: t('common.returnExplore'), verso: '/esplora' }}
                />
            );
        return (
            <StatoErrore
                titolo={t('text.detailsAreUnavailable')}
                messaggio={erroreCatalogo(stato.causa)}
                suRiprova={riprova}
            />
        );
    }
    return (
        <section className="pagina">
            <nav className={stile.percorso} aria-label={t('text.catalogBreadcrumb')}>
                <Link to="/esplora">{t('text.explore2')}</Link>
            </nav>
            {children(stato.dati)}
        </section>
    );
}

function LinkEsterno({ url, children }: { url: string; children: ReactNode }) {
    return (
        <a href={url} target="_blank" rel="noopener noreferrer">
            {children} ↗
        </a>
    );
}

function LinkMappato({
    id,
    nome,
    carica,
}: {
    id: number;
    nome: string;
    carica: (id: number) => Promise<string | null>;
}) {
    const richiesta = useCallback(() => carica(id), [id, carica]);
    const { stato, riprova } = useRisorsa(`${nome}:${id}`, richiesta);
    if (stato.tipo === 'caricamento') return <span role="status">{t('text.checkingTheLink')}{' '}{nome}…</span>;
    if (stato.tipo === 'errore')
        return (
            <Avviso tipo="errore">
                {t('text.theLink')}{' '}{nome} {t('text.isCurrentlyUnavailable')}{' '}
                <Bottone variante="contorno" onClick={riprova}>
                    {t('text.retryLink')}{' '}{nome}
                </Bottone>
            </Avviso>
        );
    return stato.dati === null ? null : <LinkEsterno url={stato.dati}>{t('text.openOn')}{' '}{nome}</LinkEsterno>;
}

export function DettaglioArtista() {
    const { stato } = useAutenticazione();
    const lingua = useLingua();
    // Il flag seguito è personale: attendere l'identità evita un primo
    // caricamento anonimo seguito da una seconda richiesta autenticata.
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo={t('text.checkingYourSession')} />;
    return (
        <PaginaDettaglio tipo="artista" carica={leggiArtista}>
            {(artista) => (
                <>
                    <Vetrina visuale={
                        <figure className={stile.ritrattoArtista}>
                            <ArteCatalogo
                                immagine={artista.immagineUrl}
                                descrizione={t('catalog.photo', { name: artista.nome })}
                            />
                            {artista.creditoImmagine ? <figcaption className={stile.credito}>
                                {t('text.photo')}{' '}{artista.creditoImmagine.autore}.{' '}
                                {artista.creditoImmagine.licenza}
                                {artista.creditoImmagine.fonteUrl ? (
                                    <>
                                        {' '}
                                        ·{' '}
                                        <LinkEsterno url={artista.creditoImmagine.fonteUrl}>
                                            {t('text.source')}</LinkEsterno>
                                    </>
                                ) : null}
                                {artista.creditoImmagine.modificata
                                    ? t('catalog.modifiedImage')
                                    : null}
                            </figcaption> : null}
                        </figure>
                    }>
                        <div className="occhiello">{t('text.artistLocalCatalog')}</div>
                        <h1 className="titolo">{artista.nome}</h1>
                        <div className={stile.metadati}>
                            {artista.generi.map((g) => (
                                <span key={g.id}>{g.nome}</span>
                            ))}
                        </div>
                        <section className={stile.biografia} aria-labelledby="biografia-artista">
                            <h2 id="biografia-artista">{t('catalog.biography')}</h2>
                            <p className={stile.testo}>{artista.bio || artista.biografia?.[lingua] || t('catalog.bioUnavailable')}</p>
                            {artista.popolaritaDeezer ? <div className={stile.fan}>
                                <strong>{new Intl.NumberFormat(locale()).format(artista.popolaritaDeezer.fan)}</strong>
                                <span>{t('catalog.deezerFans')}</span>
                                <p>{t('catalog.deezerFansNote')}</p>
                                {artista.popolaritaDeezer.url ? <LinkEsterno url={artista.popolaritaDeezer.url}>{t('catalog.deezerProfileLink')}</LinkEsterno> : null}
                            </div> : null}
                        </section>
                        <FollowArtista key={artista.id} artista={artista} />
                        {stato.tipo === 'autenticato' && stato.utente.ruolo === 'ADMIN' ? <BottoneLink variante="contorno" to={`/admin/artisti/${artista.id}`}>{t('provider.manage')}</BottoneLink> : null}
                    </Vetrina>
                    <DiscografiaArtista key={artista.id} id={artista.id}>
                    <div className="sezione">
                        <h2>{t('text.album')}</h2>
                    </div>
                    {artista.album.length ? (
                        <div className={stile.griglia}>
                            {artista.album.map((a) => (
                                <CartaAlbum key={a.id} album={a} />
                            ))}
                        </div>
                    ) : (
                        <p className="introduzione">{t('text.noAlbumsAvailable')}</p>
                    )}
                    <div className="sezione">
                        <h2>{t('text.tracks')}</h2>
                    </div>
                    <ListaBrani brani={artista.brani} />
                    </DiscografiaArtista>
                    <div className="sezione">
                        <h2>{t('text.upcomingEvents')}</h2>
                    </div>
                    {artista.eventi.length ? (
                        <ul className={stile.eventi}>
                            {artista.eventi.map((e) => (
                                <li key={e.id}>
                                    <strong><Link to={`/eventi/${e.id}`}>{e.titolo}</Link></strong>
                                    <p>
                                        {dataCatalogo(e.dataEvento)} ·{' '}
                                        {e.oraEvento?.slice(0, 5) ?? t('catalog.timeUnavailable')}
                                    </p>
                                    <p>
                                        {[e.luogo, e.citta].filter(Boolean).join(' · ') ||
                                            t('catalog.locationUnavailable')}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="introduzione">{t('text.noUpcomingEvents')}</p>
                    )}
                </>
            )}
        </PaginaDettaglio>
    );
}

export function DettaglioBrano() {
    return (
        <PaginaDettaglio tipo="brano" carica={leggiBrano}>
            {(brano) => (
                <>
                    <Vetrina visuale={<ArteCatalogo immagine={brano.album?.copertinaUrl ?? null} descrizione={t('catalog.cover', { name: brano.titolo })} />}>
                        <div className="occhiello">{t('text.trackLocalCatalog')}</div>
                        <h1 className="titolo">{brano.titolo}</h1>
                        <p>
                            {t('text.by')}{' '}<Link to={`/artisti/${brano.artista.id}`}>{brano.artista.nome}</Link>
                        </p>
                        <p>{dataCatalogo(brano.dataPubblicazione)}</p>
                        {brano.collaboratori ? <p>{t('text.collaborations')}{' '}{brano.collaboratori}</p> : null}
                    </Vetrina>
                    <div className="sezione">
                        <h2>{t('text.album')}</h2>
                    </div>
                    {brano.album ? (
                        <div className={stile.immagineDettaglio}>
                            <CartaAlbum album={brano.album} />
                        </div>
                    ) : (
                        <p className="introduzione">{t('text.thisTrackIsNotAssociatedWith')}</p>
                    )}
                    <div className="sezione">
                        <h2>{t('text.listeningLinks')}</h2>
                    </div>
                    <div className={stile.azioni}>
                        {brano.urlSpotify ? (
                            <LinkEsterno url={brano.urlSpotify}>{t('text.openOnSpotify')}</LinkEsterno>
                        ) : null}
                    </div>
                </>
            )}
        </PaginaDettaglio>
    );
}

export function DettaglioAlbum() {
    return (
        <PaginaDettaglio tipo="album" carica={leggiAlbum}>
            {(album) => (
                <>
                    <Vetrina visuale={<ArteCatalogo immagine={album.copertinaUrl} descrizione={t('catalog.cover', { name: album.titolo })} />}>
                        <div className="occhiello">{t('text.albumLocalCatalog')}</div>
                        <h1 className="titolo">{album.titolo}</h1>
                        <p>
                            {t('text.by')}{' '}<Link to={`/artisti/${album.artista.id}`}>{album.artista.nome}</Link>
                        </p>
                        <p>{dataCatalogo(album.dataPubblicazione)}</p>
                    </Vetrina>
                    <div className="sezione">
                        <h2>{t('text.tracks')}</h2>
                    </div>
                    <ListaBrani brani={album.brani} />
                    <div className={stile.azioni}>
                        <LinkMappato id={album.id} nome="Spotify" carica={leggiLinkSpotify} />
                    </div>
                </>
            )}
        </PaginaDettaglio>
    );
}
