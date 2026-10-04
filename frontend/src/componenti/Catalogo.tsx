import { t } from '../localizzazione/lingua';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AlbumSintetico, ArtistaSintetico, Brano, BranoElenco } from '../api/catalogo';
import { dataCatalogo } from '../catalogo/formato';
import stile from './Catalogo.module.css';

function Decorazione() {
    return (
        <>
            <span className={stile.anello} aria-hidden="true">
                ◌
            </span>
            <span className={stile.didascalia}>{t('text.clubArtwork')}</span>
        </>
    );
}

function ImmagineReale({ url, descrizione }: { url: string; descrizione: string }) {
    const [fallita, impostaFallita] = useState(false);
    return fallita ? (
        <Decorazione />
    ) : (
        <img src={url} alt={descrizione} loading="lazy" referrerPolicy="no-referrer" onError={() => impostaFallita(true)} />
    );
}

export function ArteCatalogo({
    immagine,
    descrizione,
}: {
    immagine: string | null;
    descrizione: string;
}) {
    return (
        <div className={stile.arte}>
            {immagine ? (
                <ImmagineReale key={immagine} url={immagine} descrizione={descrizione} />
            ) : (
                <Decorazione />
            )}
        </div>
    );
}

export function CartaArtista({ artista }: { artista: ArtistaSintetico }) {
    return (
        <Link
            className={stile.carta}
            to={`/artisti/${artista.id}`}
            aria-label={t('catalog.openArtist', { name: artista.nome })}
        >
            <ArteCatalogo immagine={artista.immagineUrl} descrizione={t('catalog.photo', { name: artista.nome })} />
            <div className={stile.copia}>
                <small>{t('text.localArtist')}</small>
                <h3>{artista.nome}</h3>
                <span aria-hidden="true">↗</span>
            </div>
        </Link>
    );
}

export function CartaAlbum({ album }: { album: AlbumSintetico }) {
    return (
        <Link
            className={stile.carta}
            to={`/album/${album.id}`}
            aria-label={t('catalog.openAlbum', { name: album.titolo })}
        >
            <ArteCatalogo
                immagine={album.copertinaUrl}
                descrizione={t('catalog.cover', { name: album.titolo })}
            />
            <div className={stile.copia}>
                <small>{t('text.localAlbum')}</small>
                <h3>{album.titolo}</h3>
                <span aria-hidden="true">↗</span>
            </div>
        </Link>
    );
}

export function CartaBrano({ brano }: { brano: Brano }) {
    return (
        <article className={stile.cartaTesto}>
            <small>{t('text.localTrack')}</small>
            <h3>
                <Link to={`/brani/${brano.id}`}>{brano.titolo}</Link>
            </h3>
            <Link to={`/artisti/${brano.artista.id}`}>{brano.artista.nome}</Link>
            <p>{dataCatalogo(brano.dataPubblicazione)}</p>
            {brano.collaboratori ? <p>{t('text.collaborations')}{' '}{brano.collaboratori}</p> : null}
        </article>
    );
}

export function ListaBrani({ brani }: { brani: BranoElenco[] }) {
    return brani.length === 0 ? (
        <p className="introduzione">{t('text.noTracksAvailable')}</p>
    ) : (
        <ul className={stile.brani}>
            {brani.map((brano) => (
                <li key={brano.id}>
                    <Link to={`/brani/${brano.id}`}>
                        <strong>{brano.titolo}</strong>
                        <span aria-hidden="true">↗</span>
                    </Link>
                    <span>{dataCatalogo(brano.dataPubblicazione)}</span>
                </li>
            ))}
        </ul>
    );
}
