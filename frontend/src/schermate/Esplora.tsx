import { t } from '../localizzazione/lingua';
import { Link } from 'react-router';
import { elencaEventi } from '../api/eventi';
import { CopertinaEvento } from '../eventi/CopertinaEvento';
import { InformazioniEvento } from '../eventi/InformazioniEvento';
import { useCallback, useState } from 'react';
import {
    cercaCatalogo,
    elencaArtisti,
    elencaGeneri,
    MASSIMO_RICERCA,
    MINIMO_RICERCA,
} from '../api/catalogo';
import { erroreCatalogo } from '../catalogo/formato';
import { useRisorsa } from '../catalogo/useRisorsa';
import { Bottone } from '../componenti/Bottone';
import { CampoTesto } from '../componenti/CampoTesto';
import { CartaArtista, CartaBrano } from '../componenti/Catalogo';
import { StatoCaricamento, StatoErrore, StatoVuoto } from '../componenti/Stati';
import { Vetrina } from '../componenti/Vetrina';
import stile from './Catalogo.module.css';

const DEBOUNCE_MS = 300;

function RisultatiRicerca({ query }: { query: string }) {
    const carica = useCallback(() => cercaCatalogo(query), [query]);
    const { stato, riprova } = useRisorsa(query, carica, DEBOUNCE_MS);
    if (stato.tipo === 'caricamento')
        return <StatoCaricamento testo={t('text.searchingTheCatalog')} livelloTitolo={3} />;
    if (stato.tipo === 'errore')
        return (
            <StatoErrore
                messaggio={erroreCatalogo(stato.causa)}
                suRiprova={riprova}
                livelloTitolo={3}
            />
        );
    const { artisti, brani } = stato.dati;
    if (artisti.length === 0 && brani.length === 0)
        return (
            <StatoVuoto
                occhiello={t('text.localSearch')}
                titolo={t('text.noResults')}
                messaggio={t('text.tryAnotherNameOrTitle')}
                livelloTitolo={3}
            />
        );
    return (
        <>
            <div className="sezione">
                <h3>{t('text.artists')}</h3>
            </div>
            {artisti.length ? (
                <div className={stile.griglia}>
                    {artisti.map((a) => (
                        <CartaArtista key={a.id} artista={a} />
                    ))}
                </div>
            ) : (
                <p>{t('text.noArtistsFound')}</p>
            )}
            <div className="sezione">
                <h3>{t('text.tracks')}</h3>
            </div>
            {brani.length ? (
                <div className={stile.griglia}>
                    {brani.map((b) => (
                        <CartaBrano key={b.id} brano={b} />
                    ))}
                </div>
            ) : (
                <p>{t('text.noTracksFound')}</p>
            )}
            <p className={stile.nota}>{t('text.upTo20ArtistsAnd20')}</p>
        </>
    );
}

function ArtistiPerGenere({ genereId }: { genereId: number | undefined }) {
    const carica = useCallback(() => elencaArtisti(genereId), [genereId]);
    const { stato, riprova } = useRisorsa(`genere:${genereId ?? 'tutti'}`, carica);
    if (stato.tipo === 'caricamento')
        return <StatoCaricamento testo={t('text.loadingArtists')} livelloTitolo={3} />;
    if (stato.tipo === 'errore')
        return (
            <StatoErrore
                messaggio={erroreCatalogo(stato.causa)}
                suRiprova={riprova}
                livelloTitolo={3}
            />
        );
    if (stato.dati.length === 0)
        return (
            <StatoVuoto
                occhiello={t('text.localCatalog')}
                titolo={t('text.noArtistsAvailable')}
                messaggio={t('text.chooseAnotherGenreOrGoBack')}
                livelloTitolo={3}
            />
        );
    return (
        <div className={stile.griglia}>
            {stato.dati.map((a) => (
                <CartaArtista key={a.id} artista={a} />
            ))}
        </div>
    );
}

// Stessa API pubblica usata dalla mappa: i Ticketmaster rifiutati non arrivano al browser.
function ProssimiEventi() {
    const { stato, riprova } = useRisorsa('esplora-eventi', elencaEventi);
    if (stato.tipo === 'errore')
        return <StatoErrore messaggio={erroreCatalogo(stato.causa)} suRiprova={riprova} />;
    if (stato.tipo !== 'pronto' || !stato.dati.length) return null;
    return (
        <section aria-label={t('ollama.exploreEvents')}>
            <div className="sezione">
                <h2>{t('ollama.exploreEvents')}</h2>
            </div>
            <div className={stile.griglia}>
                {stato.dati.slice(0, 6).map((e) => (
                    <article className={stile.eventoEsplora} key={e.id}>
                        <CopertinaEvento evento={e} />
                        <h3>
                            <Link to={`/eventi/${e.id}?filtro=tutti`}>{e.titolo}</Link>
                        </h3>
                        <InformazioniEvento evento={e} />
                    </article>
                ))}
            </div>
        </section>
    );
}

export function Esplora() {
    const [ricerca, impostaRicerca] = useState('');
    const [genereId, impostaGenereId] = useState<number>();
    const generi = useRisorsa('generi', elencaGeneri);
    const query = ricerca.trim();
    const troppoLunga = query.length > MASSIMO_RICERCA;

    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">{t('text.localCatalog')}</div>
                <h1 className="titolo">{t('text.explore3')}</h1>
                <p>{t('text.artistsTracksAndAlbumsAlreadyOn')}</p>
            </Vetrina>

            <section className={stile.strumenti} aria-label={t('text.catalogSearch')}>
                <h2>{t('text.findArtistsAndTracks')}</h2>
                <CampoTesto
                    etichetta={t('text.searchTheLocalCatalog')}
                    type="search"
                    value={ricerca}
                    onChange={(e) => impostaRicerca(e.target.value)}
                    maxLength={MASSIMO_RICERCA}
                    suggerimento={t('text.2To100CharactersSearchArtists')}
                    errore={troppoLunga ? t('catalog.searchMax') : null}
                />
                {query.length > 0 ? (
                    <section aria-label={t('text.searchResults')}>
                        <div className="sezione">
                            <h2>{t('text.resultsInTheLocalCatalog')}</h2>
                        </div>
                        {query.length < MINIMO_RICERCA ? (
                            <p role="status">{t('text.enterAtLeast2Characters')}</p>
                        ) : troppoLunga ? (
                            <p role="alert">{t('text.yourSearchIsTooLong')}</p>
                        ) : (
                            <RisultatiRicerca query={query} />
                        )}
                    </section>
                ) : null}
            </section>

            <section aria-label={t('text.artistsByGenre')}>
                <div className="sezione">
                    <h2>{t('text.artistsByGenre')}</h2>
                </div>
                <p className="introduzione">{t('text.theGenreOnlyFiltersThisList')}</p>
                {generi.stato.tipo === 'caricamento' ? (
                    <StatoCaricamento testo={t('text.loadingGenres')} livelloTitolo={3} />
                ) : generi.stato.tipo === 'errore' ? (
                    <StatoErrore
                        messaggio={erroreCatalogo(generi.stato.causa)}
                        suRiprova={generi.riprova}
                        livelloTitolo={3}
                    />
                ) : (
                    <>
                        <div
                            className={stile.generi}
                            role="group"
                            aria-label={t('text.filterArtistsByGenre')}
                        >
                            <Bottone
                                variante={genereId === undefined ? 'primario' : 'contorno'}
                                aria-pressed={genereId === undefined}
                                onClick={() => impostaGenereId(undefined)}
                            >
                                {t('text.all')}
                            </Bottone>
                            {generi.stato.dati.map((g) => (
                                <Bottone
                                    key={g.id}
                                    variante={genereId === g.id ? 'primario' : 'contorno'}
                                    aria-pressed={genereId === g.id}
                                    onClick={() => impostaGenereId(g.id)}
                                >
                                    {g.nome}
                                </Bottone>
                            ))}
                        </div>
                        <ArtistiPerGenere genereId={genereId} />
                    </>
                )}
            </section>
            <ProssimiEventi />
            <div className="piede">{t('text.exploreTheLocalCatalogTestEnvironment')}</div>
        </section>
    );
}
