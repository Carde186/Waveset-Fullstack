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
            <span className={stile.didascalia}>Grafica Club</span>
        </>
    );
}

function ImmagineReale({ url, descrizione }: { url: string; descrizione: string }) {
    const [fallita, impostaFallita] = useState(false);
    return fallita ? (
        <Decorazione />
    ) : (
        <img src={url} alt={descrizione} loading="lazy" onError={() => impostaFallita(true)} />
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
            aria-label={`Apri artista ${artista.nome}`}
        >
            {/* La lista non fornisce crediti fotografici: usa arte astratta. */}
            <ArteCatalogo immagine={null} descrizione={artista.nome} />
            <div className={stile.copia}>
                <small>Artista locale</small>
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
            aria-label={`Apri album ${album.titolo}`}
        >
            <ArteCatalogo
                immagine={album.copertinaUrl}
                descrizione={`Copertina di ${album.titolo}`}
            />
            <div className={stile.copia}>
                <small>Album locale</small>
                <h3>{album.titolo}</h3>
                <span aria-hidden="true">↗</span>
            </div>
        </Link>
    );
}

export function CartaBrano({ brano }: { brano: Brano }) {
    return (
        <article className={stile.cartaTesto}>
            <small>Brano locale</small>
            <h3>
                <Link to={`/brani/${brano.id}`}>{brano.titolo}</Link>
            </h3>
            <Link to={`/artisti/${brano.artista.id}`}>{brano.artista.nome}</Link>
            <p>{dataCatalogo(brano.dataPubblicazione)}</p>
            {brano.collaboratori ? <p>Collaborazioni: {brano.collaboratori}</p> : null}
        </article>
    );
}

export function ListaBrani({ brani }: { brani: BranoElenco[] }) {
    return brani.length === 0 ? (
        <p className="introduzione">Nessun brano disponibile.</p>
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
