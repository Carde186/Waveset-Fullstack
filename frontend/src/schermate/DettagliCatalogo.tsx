import { useCallback, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
    idDaPercorso,
    leggiAlbum,
    leggiArtista,
    leggiBrano,
    leggiLinkApple,
    leggiLinkSpotify,
} from '../api/catalogo';
import { ErroreApi } from '../api/client';
import { dataCatalogo, erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Avviso } from '../componenti/Avviso';
import { Bottone } from '../componenti/Bottone';
import { ArteCatalogo, CartaAlbum, ListaBrani } from '../componenti/Catalogo';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import stile from './Catalogo.module.css';

function PaginaDettaglio<T>({
    tipo,
    carica,
    children,
}: {
    tipo: string;
    carica: (id: number) => Promise<T>;
    children: (dati: T) => ReactNode;
}) {
    const { id: parametro } = useParams();
    const id = idDaPercorso(parametro);
    const richiesta = useCallback(
        () => (id === null ? Promise.reject(new ErroreApi(404)) : carica(id)),
        [id, carica],
    );
    const { stato, riprova } = useRisorsa(`${tipo}:${parametro}`, richiesta);
    if (stato.tipo === 'caricamento') return <StatoCaricamento testo="Carico il dettaglio…" />;
    if (stato.tipo === 'errore') {
        if (stato.causa instanceof ErroreApi && stato.causa.stato === 404)
            return (
                <StatoVuoto
                    occhiello="404"
                    titolo={`${tipo} non trovato.`}
                    messaggio="Questo elemento non è presente nel catalogo locale."
                    azione={{ testo: 'Torna a Esplora', verso: '/esplora' }}
                />
            );
        return (
            <StatoErrore
                titolo="Il dettaglio non è disponibile."
                messaggio={erroreCatalogo(stato.causa)}
                suRiprova={riprova}
            />
        );
    }
    return (
        <section className="pagina">
            <nav className={stile.percorso} aria-label="Percorso nel catalogo">
                <Link to="/esplora">← Esplora</Link>
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
    if (stato.tipo === 'caricamento') return <span role="status">Controllo il link {nome}…</span>;
    if (stato.tipo === 'errore')
        return (
            <Avviso tipo="errore">
                Il link {nome} non è disponibile al momento.{' '}
                <Bottone variante="contorno" onClick={riprova}>
                    Riprova link {nome}
                </Bottone>
            </Avviso>
        );
    return stato.dati === null ? null : <LinkEsterno url={stato.dati}>Apri su {nome}</LinkEsterno>;
}

export function DettaglioArtista() {
    return (
        <PaginaDettaglio tipo="Artista" carica={leggiArtista}>
            {(artista) => (
                <>
                    <Vetrina>
                        <div className="occhiello">Artista · Catalogo locale</div>
                        <h1 className="titolo">{artista.nome}</h1>
                        <p className={stile.testo}>{artista.bio || 'Biografia non disponibile.'}</p>
                        <div className={stile.metadati}>
                            {artista.generi.map((g) => (
                                <span key={g.id}>{g.nome}</span>
                            ))}
                        </div>
                        {artista.seguito ? <p>Artista che segui</p> : null}
                    </Vetrina>
                    {artista.immagineUrl && artista.creditoImmagine ? (
                        <figure className={stile.immagineDettaglio}>
                            <ArteCatalogo
                                immagine={artista.immagineUrl}
                                descrizione={`Foto di ${artista.nome}`}
                            />
                            <figcaption className={stile.credito}>
                                Foto: {artista.creditoImmagine.autore}.{' '}
                                {artista.creditoImmagine.licenza}
                                {artista.creditoImmagine.fonteUrl ? (
                                    <>
                                        {' '}
                                        ·{' '}
                                        <LinkEsterno url={artista.creditoImmagine.fonteUrl}>
                                            Fonte
                                        </LinkEsterno>
                                    </>
                                ) : null}
                                {artista.creditoImmagine.modificata
                                    ? ' · Immagine modificata.'
                                    : null}
                            </figcaption>
                        </figure>
                    ) : null}
                    <div className="sezione">
                        <h2>Album</h2>
                    </div>
                    {artista.album.length ? (
                        <div className={stile.griglia}>
                            {artista.album.map((a) => (
                                <CartaAlbum key={a.id} album={a} />
                            ))}
                        </div>
                    ) : (
                        <p className="introduzione">Nessun album disponibile.</p>
                    )}
                    <div className="sezione">
                        <h2>Brani</h2>
                    </div>
                    <ListaBrani brani={artista.brani} />
                    <div className="sezione">
                        <h2>Prossimi eventi</h2>
                    </div>
                    {artista.eventi.length ? (
                        <ul className={stile.eventi}>
                            {artista.eventi.map((e) => (
                                <li key={e.id}>
                                    <strong><Link to={`/eventi/${e.id}`}>{e.titolo}</Link></strong>
                                    <p>
                                        {dataCatalogo(e.dataEvento)} ·{' '}
                                        {e.oraEvento?.slice(0, 5) ?? 'Orario non disponibile'}
                                    </p>
                                    <p>
                                        {[e.luogo, e.citta].filter(Boolean).join(' · ') ||
                                            'Luogo non disponibile'}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="introduzione">Nessun evento in arrivo.</p>
                    )}
                </>
            )}
        </PaginaDettaglio>
    );
}

export function DettaglioBrano() {
    return (
        <PaginaDettaglio tipo="Brano" carica={leggiBrano}>
            {(brano) => (
                <>
                    <Vetrina>
                        <div className="occhiello">Brano · Catalogo locale</div>
                        <h1 className="titolo">{brano.titolo}</h1>
                        <p>
                            Di <Link to={`/artisti/${brano.artista.id}`}>{brano.artista.nome}</Link>
                        </p>
                        <p>{dataCatalogo(brano.dataPubblicazione)}</p>
                        {brano.collaboratori ? <p>Collaborazioni: {brano.collaboratori}</p> : null}
                    </Vetrina>
                    <div className="sezione">
                        <h2>Album</h2>
                    </div>
                    {brano.album ? (
                        <div className={stile.immagineDettaglio}>
                            <CartaAlbum album={brano.album} />
                        </div>
                    ) : (
                        <p className="introduzione">Questo brano non è associato a un album.</p>
                    )}
                    <div className="sezione">
                        <h2>Link di ascolto</h2>
                    </div>
                    <div className={stile.azioni}>
                        {brano.urlSpotify ? (
                            <LinkEsterno url={brano.urlSpotify}>Apri su Spotify</LinkEsterno>
                        ) : null}
                        <LinkMappato id={brano.id} nome="Apple Music" carica={leggiLinkApple} />
                    </div>
                </>
            )}
        </PaginaDettaglio>
    );
}

export function DettaglioAlbum() {
    return (
        <PaginaDettaglio tipo="Album" carica={leggiAlbum}>
            {(album) => (
                <>
                    <Vetrina>
                        <div className="occhiello">Album · Catalogo locale</div>
                        <h1 className="titolo">{album.titolo}</h1>
                        <p>
                            Di <Link to={`/artisti/${album.artista.id}`}>{album.artista.nome}</Link>
                        </p>
                        <p>{dataCatalogo(album.dataPubblicazione)}</p>
                    </Vetrina>
                    <div className={stile.immagineDettaglio}>
                        <ArteCatalogo
                            immagine={album.copertinaUrl}
                            descrizione={`Copertina di ${album.titolo}`}
                        />
                    </div>
                    <div className="sezione">
                        <h2>Brani</h2>
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
