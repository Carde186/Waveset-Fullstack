// Helper condivisi dai lotti 2+ del catalogo reale (Fred again.., Martin
// Garrix, Avicii, Alesso, Kygo, Calvin Harris, David Guetta, ODESZA — vedi
// CLAUDE.md, "Catalogo reale"). Stesso principio di idempotenza di
// importaCatalogoRealeLotto1.js (mai un UPDATE su una riga già presente,
// transazione aperta/chiusa da applicaLotto, chiave naturale non id
// numerico) ma generalizzato per due casi che il lotto 1 non aveva:
//   - un artista con PIÙ di un album (es. Kygo: "KYGO" e "Cloud Nine")
//   - un brano SENZA album (`album_id` NULL — es. i singoli di Martin
//     Garrix): la voce lotto lo esprime in `singoli`, non in `albums`
// Non tocca né duplica LOTTO/le funzioni di importaCatalogoRealeLotto1.js:
// quello resta il lotto 1, invariato e già testato.
require('dotenv').config();

const pool = require('../src/config/database');

// Stesso comportamento di unicaRigaOAmbigua in importaCatalogoRealeLotto1.js
// (duplicata qui, non importata: sono 5 righe, importarla creerebbe un
// accoppiamento inutile fra "lotto 1" e "infrastruttura condivisa").
function unicaRigaOAmbigua(righe, descrizioneChiave) {
    if (righe.length > 1) {
        throw new Error(
            `Più righe trovate per ${descrizioneChiave}: non scelgo quale usare, va risolto a mano prima di rilanciare lo script.`,
        );
    }
    return righe[0] ?? null;
}

async function assicuraArtista(connessione, voce, applica) {
    const [righe] = await connessione.query(
        'SELECT id FROM artista WHERE nome = ?',
        [voce.nome],
    );
    const esistente = unicaRigaOAmbigua(
        righe,
        `artista con nome "${voce.nome}"`,
    );
    if (esistente) {
        return { id: esistente.id, esito: 'già presente' };
    }
    if (!applica) {
        return { id: null, esito: 'da inserire (anteprima)' };
    }
    const [risultato] = await connessione.query(
        `INSERT INTO artista
            (nome, bio, immagine_url, immagine_autore, immagine_licenza, immagine_fonte_url, immagine_modificata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            voce.nome,
            voce.bio,
            voce.immagineUrl,
            voce.credito.autore,
            voce.credito.licenza,
            voce.credito.fonteUrl,
            voce.credito.modificata,
        ],
    );
    return { id: risultato.insertId, esito: 'inserito' };
}

// Diversa da assicuraGenere del lotto 1: quella salta l'associazione se il
// genere non esiste ancora (era pensata solo per "Techno", già presente dal
// seed). Qui "Elettronica" non esiste ancora nel database — va CREATO, ma
// solo insieme al primo artista del lotto che lo usa (mai come genere vuoto
// inserito a sé): con --applica, la creazione avviene dentro la stessa
// transazione di applicaLotto, quindi non è mai visibile a metà (un genere
// creato ma senza nessun artista associato).
async function assicuraGenereCreaSeMancante(
    connessione,
    artistaId,
    genereNome,
    applica,
) {
    const [righeGenere] = await connessione.query(
        'SELECT id FROM genere WHERE nome = ?',
        [genereNome],
    );

    let genereId;
    let genereCreatoOra = false;

    if (righeGenere.length > 0) {
        genereId = righeGenere[0].id;
    } else if (!applica) {
        return { esito: `genere "${genereNome}" da creare (anteprima)` };
    } else {
        const [risultato] = await connessione.query(
            'INSERT INTO genere (nome) VALUES (?)',
            [genereNome],
        );
        genereId = risultato.insertId;
        genereCreatoOra = true;
    }

    const [righeAssociazione] = await connessione.query(
        'SELECT 1 FROM artista_genere WHERE artista_id = ? AND genere_id = ?',
        [artistaId, genereId],
    );
    if (righeAssociazione.length > 0) {
        return { esito: 'già presente' };
    }
    if (!applica) {
        return { esito: 'da associare (anteprima)' };
    }
    await connessione.query(
        'INSERT IGNORE INTO artista_genere (artista_id, genere_id) VALUES (?, ?)',
        [artistaId, genereId],
    );
    return {
        esito: genereCreatoOra
            ? 'genere creato e associato'
            : 'associato (o già presente)',
    };
}

async function assicuraAlbum(connessione, artistaId, album, applica) {
    const [righe] = await connessione.query(
        'SELECT id FROM album WHERE titolo = ? AND artista_id = ?',
        [album.titolo, artistaId],
    );
    const esistente = unicaRigaOAmbigua(
        righe,
        `album "${album.titolo}" dell'artista id ${artistaId}`,
    );
    if (esistente) {
        return { id: esistente.id, esito: 'già presente' };
    }
    if (!applica) {
        return { id: null, esito: 'da inserire (anteprima)' };
    }
    const [risultato] = await connessione.query(
        'INSERT INTO album (titolo, data_pubblicazione, artista_id, copertina_url) VALUES (?, ?, ?, ?)',
        [album.titolo, album.dataPubblicazione, artistaId, album.copertinaUrl],
    );
    return { id: risultato.insertId, esito: 'inserito' };
}

// albumId può essere null (brano senza album, es. i singoli di Martin
// Garrix e "Marea" di Fred again..): la query di ricerca resta comunque
// titolo+artista_id, mai titolo+album_id, quindi non cambia se il brano ha
// o non ha un album — stessa funzione di importaCatalogoRealeLotto1.js,
// duplicata qui per non introdurre una dipendenza incrociata fra lotti.
async function assicuraBrano(connessione, artistaId, albumId, brano, applica) {
    const titoliTollerati = [brano.titolo, ...(brano.titoliPrecedenti ?? [])];
    const [righe] = await connessione.query(
        'SELECT id FROM brano WHERE titolo IN (?) AND artista_id = ?',
        [titoliTollerati, artistaId],
    );
    const esistente = unicaRigaOAmbigua(
        righe,
        `brano tra ${JSON.stringify(titoliTollerati)} dell'artista id ${artistaId}`,
    );
    if (esistente) {
        return { id: esistente.id, esito: 'già presente' };
    }
    if (!applica) {
        return { id: null, esito: 'da inserire (anteprima)' };
    }
    const [risultato] = await connessione.query(
        'INSERT INTO brano (titolo, artista_id, album_id, data_pubblicazione, url_spotify) VALUES (?, ?, ?, ?, ?)',
        [
            brano.titolo,
            artistaId,
            albumId,
            brano.dataPubblicazione,
            brano.urlSpotify,
        ],
    );
    return { id: risultato.insertId, esito: 'inserito' };
}

// Transazione aperta/chiusa qui (non dal chiamante), stesso motivo di
// applicaLotto in importaCatalogoRealeLotto1.js: un errore a metà, o il
// processo che muore, non lascia mai il database con solo alcune righe di
// QUESTO lotto scritte.
async function applicaLotto(connessione, lotto, applica) {
    const risultati = [];

    if (applica) {
        await connessione.beginTransaction();
    }

    try {
        await elaboraLotto(connessione, lotto, applica, risultati);
    } catch (errore) {
        if (applica) {
            await connessione.rollback();
        }
        throw errore;
    }

    if (applica) {
        await connessione.commit();
    }

    return risultati;
}

async function elaboraLotto(connessione, lotto, applica, risultati) {
    for (const voce of lotto) {
        const artista = await assicuraArtista(connessione, voce, applica);
        risultati.push({ tipo: 'artista', nome: voce.nome, ...artista });

        if (!artista.id) {
            // Anteprima e artista non ancora esistente: nessun id da usare
            // per genere/album/brani, si segnala e basta (dipendenza dalla
            // riga sopra, non ancora inserita).
            for (const genereNome of voce.generi) {
                risultati.push({
                    tipo: 'genere',
                    nome: `${voce.nome} → ${genereNome}`,
                    esito: 'da associare (anteprima, dipende dall’artista sopra)',
                });
            }
            for (const album of voce.albums ?? []) {
                risultati.push({
                    tipo: 'album',
                    nome: album.titolo,
                    esito: 'da inserire (anteprima, dipende dall’artista sopra)',
                });
                for (const brano of album.brani) {
                    risultati.push({
                        tipo: 'brano',
                        nome: brano.titolo,
                        esito: 'da inserire (anteprima, dipende dall’artista sopra)',
                    });
                }
            }
            for (const singolo of voce.singoli ?? []) {
                risultati.push({
                    tipo: 'brano (singolo, senza album)',
                    nome: singolo.titolo,
                    esito: 'da inserire (anteprima, dipende dall’artista sopra)',
                });
            }
            continue;
        }

        for (const genereNome of voce.generi) {
            const genere = await assicuraGenereCreaSeMancante(
                connessione,
                artista.id,
                genereNome,
                applica,
            );
            risultati.push({
                tipo: 'genere',
                nome: `${voce.nome} → ${genereNome}`,
                ...genere,
            });
        }

        for (const album of voce.albums ?? []) {
            const risultatoAlbum = await assicuraAlbum(
                connessione,
                artista.id,
                album,
                applica,
            );
            risultati.push({
                tipo: 'album',
                nome: album.titolo,
                ...risultatoAlbum,
            });

            for (const brano of album.brani) {
                const risultatoBrano = await assicuraBrano(
                    connessione,
                    artista.id,
                    risultatoAlbum.id,
                    brano,
                    applica,
                );
                risultati.push({
                    tipo: 'brano',
                    nome: brano.titolo,
                    ...risultatoBrano,
                });
            }
        }

        for (const singolo of voce.singoli ?? []) {
            const risultatoBrano = await assicuraBrano(
                connessione,
                artista.id,
                null,
                singolo,
                applica,
            );
            risultati.push({
                tipo: 'brano (singolo, senza album)',
                nome: singolo.titolo,
                ...risultatoBrano,
            });
        }
    }
}

// Punto d'ingresso comune da CLI per i lotti 2+: stampa risultato,
// gestisce apertura/chiusura della connessione, imposta l'exit code in
// caso di errore. Ogni lotto*.js chiama questa funzione passando il
// proprio LOTTO.
async function eseguiDaCli(lotto) {
    const applica = process.argv.includes('--applica');

    console.log(
        applica
            ? 'MODALITÀ: applicazione scritture'
            : 'MODALITÀ: sola anteprima, nessuna scrittura',
    );
    console.log('');

    const connessione = await pool.getConnection();
    try {
        const risultati = await applicaLotto(connessione, lotto, applica);
        console.table(risultati);
    } catch (errore) {
        console.error('Import fallito:', errore.message);
        process.exitCode = 1;
    } finally {
        connessione.release();
        await pool.end();
    }
}

module.exports = {
    unicaRigaOAmbigua,
    assicuraArtista,
    assicuraGenereCreaSeMancante,
    assicuraAlbum,
    assicuraBrano,
    applicaLotto,
    eseguiDaCli,
};
