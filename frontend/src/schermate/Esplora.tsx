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
        return <StatoCaricamento testo="Cerco nel catalogo…" livelloTitolo={3} />;
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
                occhiello="Ricerca locale"
                titolo="Nessun risultato."
                messaggio="Prova con un altro nome o titolo."
                livelloTitolo={3}
            />
        );
    return (
        <>
            <div className="sezione">
                <h3>Artisti</h3>
            </div>
            {artisti.length ? (
                <div className={stile.griglia}>
                    {artisti.map((a) => (
                        <CartaArtista key={a.id} artista={a} />
                    ))}
                </div>
            ) : (
                <p>Nessun artista trovato.</p>
            )}
            <div className="sezione">
                <h3>Brani</h3>
            </div>
            {brani.length ? (
                <div className={stile.griglia}>
                    {brani.map((b) => (
                        <CartaBrano key={b.id} brano={b} />
                    ))}
                </div>
            ) : (
                <p>Nessun brano trovato.</p>
            )}
            <p className={stile.nota}>Fino a 20 artisti e 20 brani del catalogo locale.</p>
        </>
    );
}

function ArtistiPerGenere({ genereId }: { genereId: number | undefined }) {
    const carica = useCallback(() => elencaArtisti(genereId), [genereId]);
    const { stato, riprova } = useRisorsa(`genere:${genereId ?? 'tutti'}`, carica);
    if (stato.tipo === 'caricamento')
        return <StatoCaricamento testo="Carico gli artisti…" livelloTitolo={3} />;
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
                occhiello="Catalogo locale"
                titolo="Nessun artista disponibile."
                messaggio="Scegli un altro genere o torna a Tutti."
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

export function Esplora() {
    const [ricerca, impostaRicerca] = useState('');
    const [genereId, impostaGenereId] = useState<number>();
    const generi = useRisorsa('generi', elencaGeneri);
    const query = ricerca.trim();
    const troppoLunga = query.length > MASSIMO_RICERCA;

    return (
        <section className="pagina">
            <Vetrina>
                <div className="occhiello">Catalogo locale</div>
                <h1 className="titolo">Esplora.</h1>
                <p>
                    Artisti, brani e album già presenti su Waveset. Parti da un genere o cerca un
                    nome.
                </p>
            </Vetrina>

            <section className={stile.strumenti} aria-label="Ricerca nel catalogo">
                <h2>Cerca artisti e brani</h2>
                <CampoTesto
                    etichetta="Cerca nel catalogo locale"
                    type="search"
                    value={ricerca}
                    onChange={(e) => impostaRicerca(e.target.value)}
                    maxLength={MASSIMO_RICERCA}
                    suggerimento="Da 2 a 100 caratteri. Cerca artisti per nome e brani per titolo."
                    errore={troppoLunga ? 'Usa al massimo 100 caratteri.' : null}
                />
                {query.length > 0 ? (
                    <section aria-label="Risultati della ricerca">
                        <div className="sezione">
                            <h2>Risultati nel catalogo locale</h2>
                        </div>
                        {query.length < MINIMO_RICERCA ? (
                            <p role="status">Scrivi almeno 2 caratteri.</p>
                        ) : troppoLunga ? (
                            <p role="alert">La ricerca è troppo lunga.</p>
                        ) : (
                            <RisultatiRicerca query={query} />
                        )}
                    </section>
                ) : null}
            </section>

            <section aria-label="Artisti per genere">
                <div className="sezione">
                    <h2>Artisti per genere</h2>
                </div>
                <p className="introduzione">
                    Il genere filtra solo questo elenco. La ricerca cerca in tutto il catalogo
                    locale.
                </p>
                {generi.stato.tipo === 'caricamento' ? (
                    <StatoCaricamento testo="Carico i generi…" livelloTitolo={3} />
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
                            aria-label="Filtra gli artisti per genere"
                        >
                            <Bottone
                                variante={genereId === undefined ? 'primario' : 'contorno'}
                                aria-pressed={genereId === undefined}
                                onClick={() => impostaGenereId(undefined)}
                            >
                                Tutti
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
            <div className="piede">
                Esplora il catalogo locale. I dati dell&apos;ambiente di prova includono artisti e
                pubblicazioni dimostrativi.
            </div>
        </section>
    );
}
