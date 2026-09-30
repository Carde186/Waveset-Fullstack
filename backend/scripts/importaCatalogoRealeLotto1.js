// Primo lotto di catalogo reale (CLAUDE.md, "Integrazioni esterne" —
// "Fonte e strategia per il catalogo reale"): 2 artisti EDM reali (Carl
// Cox, Charlotte de Witte), un album a testa, pochi brani verificati.
// Identità/discografia verificate su MusicBrainz (id sotto), foto con
// licenza libera verificate singolarmente su Wikimedia Commons (autore,
// licenza, soggetto — vedi CREDITO_IMMAGINE di ciascun artista). Nessuna
// immagine Deezer/Spotify, nessuna copertina dalla Cover Art Archive: dove
// non è stata trovata una copertina con licenza libera verificata,
// copertinaUrl resta null (fallback già gestito da src/componenti/
// Immagine.tsx, icona nota musicale).
//
// Idempotente e riutilizzabile SIA su un database nuovo SIA su uno già
// avviato (mai un reset): ogni "assicura*" cerca prima per chiave naturale
// (nome artista, titolo+artista per album/brano — nessuna di queste tabelle
// ha un vincolo UNIQUE, quindi il controllo è qui, non nello schema) e
// inserisce solo se assente. Non tocca mai una riga già presente (niente
// UPDATE): i 4 artisti demo (id 1-4, cercati per nome dai test automatici)
// restano intatti perché i loro nomi non compaiono in LOTTO.
//
// url_spotify: su un DB NUOVO (brano inserito ex novo) viene scritto subito
// col valore verificato qui sotto. Su un brano GIÀ PRESENTE (DB già
// avviato) NON viene mai aggiornato, nemmeno se in LOTTO è cambiato: stesso
// principio "mai un UPDATE" di sopra. Per popolare url_spotify sui brani
// già importati in un DB esistente (questo repository, oggi) serve
// scripts/correggiLotto1.js, azione a sé, non un effetto collaterale di
// questo script.
//
// Uso:
//   node scripts/importaCatalogoRealeLotto1.js            (anteprima, nessuna scrittura)
//   node scripts/importaCatalogoRealeLotto1.js --applica  (applica le scritture)
//
// Richiede prima lo schema di backend/db/init/11_credito_immagine_schema.sql
// applicato (su un DB nuovo arriva da solo con gli init script; su un DB
// già avviato va eseguito a mano una volta, vedi README/resoconto).
require('dotenv').config();

const pool = require('../src/config/database');

const APPLICA = process.argv.includes('--applica');

// Solo l'anno di pubblicazione originale è documentato con certezza per
// questo album (MusicBrainz release-group 67b9f899-d937-43c3-b1b4-
// e47c05adaf9a: first-release-date "2011", nessuna release nel gruppo ha
// giorno/mese per l'edizione originale) — null piuttosto che inventare un
// giorno preciso che nessuna fonte conferma.
const LOTTO = [
    {
        nome: 'Carl Cox',
        bio: "DJ e produttore britannico di techno, attivo dagli anni '80, tra le figure più longeve della scena internazionale.",
        // MusicBrainz artist MBID 8f614665-3418-4ca8-aa6a-737b4636b995
        // (score 100, disambiguazione "techno DJ" — scarta l'omonimo
        // sassofonista, MBID 467fa60c-..., score 79).
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Kappa_Futur_Festival_2025_-_Esibizione_di_Carl_Cox.jpg/500px-Kappa_Futur_Festival_2025_-_Esibizione_di_Carl_Cox.jpg',
        credito: {
            autore: 'MadBob',
            licenza: 'CC BY 4.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Kappa_Futur_Festival_2025_-_Esibizione_di_Carl_Cox.jpg',
            modificata: false,
        },
        genereNome: 'Techno',
        album: {
            // MusicBrainz release-group 67b9f899-d937-43c3-b1b4-e47c05adaf9a.
            titolo: 'All Roads Lead to the Dancefloor',
            dataPubblicazione: null,
            copertinaUrl: null, // manca: nessuna copertina con licenza libera verificata
            brani: [
                // MusicBrainz (anche a livello di recording, non solo di
                // release) segna queste 3 tracce come "solo Carl Cox" —
                // ma Apple e Spotify, per due di loro, riportano un
                // featuring reale che MusicBrainz non ha mai registrato
                // (verificato di nuovo, non un errore di lettura — vedi
                // CLAUDE.md, "Catalogo reale"). Titolo corretto per
                // rappresentarlo onestamente con lo schema attuale
                // (Brano→Artista resta N:1, il featuring entra nel
                // titolo, come fa Apple). `titoliPrecedenti`: il titolo
                // con cui la riga è già stata inserita in questo database
                // prima della correzione — assicuraBrano lo riconosce
                // come "già presente" anche prima che
                // scripts/correggiLotto1.js abbia rinominato la riga,
                // così un rerun di QUESTO script non crea mai un
                // duplicato indipendentemente dall'ordine in cui i due
                // script vengono lanciati.
                {
                    titolo: 'Short Black (feat. Juanita Timpanaro)',
                    titoliPrecedenti: ['Short Black'],
                    dataPubblicazione: null,
                    urlSpotify:
                        'https://open.spotify.com/track/2cGIsN2T7AfRkMJslDRQ17',
                },
                {
                    titolo: 'Bread & Butter',
                    dataPubblicazione: null,
                    urlSpotify:
                        'https://open.spotify.com/track/5zaQH37CuI5P6l1bbsHinh',
                },
                {
                    titolo: 'We Rob Together (feat. The Digital Primate)',
                    titoliPrecedenti: ['We Rob Together'],
                    dataPubblicazione: null,
                    urlSpotify:
                        'https://open.spotify.com/track/2RDEoNn9RPgGSOG4aWveCl',
                },
            ],
        },
    },
    {
        nome: 'Charlotte de Witte',
        bio: 'DJ e produttrice belga di techno, fondatrice dell’etichetta KNTXT.',
        // MusicBrainz artist MBID 1de4e373-e597-4087-bf3d-256ec597749e
        // (score 100, unico risultato, paese BE).
        immagineUrl:
            'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Charlotte_De_Witte_2023.jpg/500px-Charlotte_De_Witte_2023.jpg',
        credito: {
            autore: 'ManoSolo13241324',
            licenza: 'CC BY-SA 4.0',
            fonteUrl:
                'https://commons.wikimedia.org/wiki/File:Charlotte_De_Witte_2023.jpg',
            modificata: false,
        },
        genereNome: 'Techno',
        album: {
            // MusicBrainz release-group 8086971d-9974-4b16-a2f0-24fb9c3fed45,
            // primary-type Album, nessun secondary-type (non una
            // compilation/mix) — first-release-date 2025-11-07, precisa.
            titolo: 'Charlotte de Witte',
            dataPubblicazione: '2025-11-07',
            copertinaUrl: null, // manca: nessuna copertina con licenza libera verificata
            brani: [
                // La release ha anche tracce con featuring (es. "No
                // Division" con XSALT, "The Heads That Know" con Comma
                // Dee, "After the Fall" con Lisa Gerrard, "Matière Noire"
                // con Alice Evermore) — ESCLUSE apposta: lo schema
                // Brano→Artista è N:1, un featuring non ci entra senza
                // travisare la paternità. Le 3 sotto hanno artist-credit
                // "Charlotte de Witte" da sola, verificato traccia per
                // traccia.
                {
                    titolo: 'The Realm',
                    dataPubblicazione: '2025-11-07',
                    urlSpotify:
                        'https://open.spotify.com/track/5oUM6niJ1fzxxSTah13Osf',
                },
                {
                    titolo: 'Vidmahe',
                    dataPubblicazione: '2025-11-07',
                    urlSpotify:
                        'https://open.spotify.com/track/5BSiyXPRW1BCtN57VX4ovu',
                },
                {
                    titolo: 'Memento Mori',
                    dataPubblicazione: '2025-11-07',
                    urlSpotify:
                        'https://open.spotify.com/track/14FZvKr4HJKlAzf2SUSb3J',
                },
            ],
        },
    },
];

// Se la chiave naturale (nome, o titolo+artista per album/brano) combacia
// con PIÙ di una riga, non è più sicuro scegliere in automatico: nessuna
// di queste tabelle ha un vincolo UNIQUE (vedi 01_schema.sql), quindi due
// righe con lo stesso nome sono uno stato possibile del database, non
// impossibile. In quel caso lo script si ferma con un errore leggibile,
// senza scegliere quale riga usare — va risolto a mano (capire quale
// riga tenere, correggere/unire i duplicati) prima di rilanciarlo.
function unicaRigaOAmbigua(righe, descrizioneChiave) {
    if (righe.length > 1) {
        throw new Error(
            `Più righe trovate per ${descrizioneChiave}: non scelgo quale usare, va risolto a mano prima di rilanciare lo script.`,
        );
    }
    return righe[0] ?? null;
}

// Mai un UPDATE su un artista già presente: se il nome combacia (a una
// sola riga), l'id esistente si riusa così com'è, il resto della voce
// (bio/immagine/credito) viene ignorato — corregge un dato già in DB è
// un'azione ADMIN a sé (CLAUDE.md, "Cosa fa davvero l'ADMIN"), non un
// effetto collaterale di questo script.
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

async function assicuraGenere(connessione, artistaId, genereNome, applica) {
    const [righeGenere] = await connessione.query(
        'SELECT id FROM genere WHERE nome = ?',
        [genereNome],
    );
    if (righeGenere.length === 0) {
        return {
            esito: `genere "${genereNome}" non trovato — associazione saltata`,
        };
    }
    // Controllo esplicito anche in anteprima: senza, questa funzione
    // diceva sempre "da associare" appena il genere esisteva, anche
    // quando l'associazione c'era già — un'anteprima rieseguita dopo un
    // --applica reale non risultava mai "nulla da inserire" per questa
    // riga, pur non scrivendo nulla di nuovo (INSERT IGNORE sotto è
    // comunque un no-op sulla PK composita già presente).
    const [righeAssociazione] = await connessione.query(
        'SELECT 1 FROM artista_genere WHERE artista_id = ? AND genere_id = ?',
        [artistaId, righeGenere[0].id],
    );
    if (righeAssociazione.length > 0) {
        return { esito: 'già presente' };
    }
    if (!applica) {
        return { esito: 'da associare (anteprima)' };
    }
    // INSERT IGNORE: la PK composita (artista_id, genere_id) rende
    // l'operazione idempotente da sola, senza bisogno di un SELECT prima.
    await connessione.query(
        'INSERT IGNORE INTO artista_genere (artista_id, genere_id) VALUES (?, ?)',
        [artistaId, righeGenere[0].id],
    );
    return { esito: 'associato (o già presente)' };
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

// Cerca per il titolo corrente MA ANCHE per eventuali titoliPrecedenti
// (vedi i due brani Carl Cox in LOTTO): una riga già inserita con un
// titolo precedente conta comunque come "già presente", non solo quella
// col titolo nuovo — altrimenti, se questo script gira prima che
// scripts/correggiLotto1.js abbia rinominato la riga esistente, non la
// troverebbe e ne inserirebbe una seconda con il titolo nuovo (duplicato).
// La rinomina della riga già presente resta comunque compito esclusivo di
// correggiLotto1.js: qui, se la riga esiste (con qualunque titolo
// tollerato), NON viene mai né rinominata né aggiornata nell'url_spotify —
// stesso principio di assicuraArtista, "mai un UPDATE su una riga già
// presente". Un url_spotify nuovo per un brano già in catalogo va sempre
// e solo attraverso correggiLotto1.js, mai come effetto collaterale di un
// rerun di questo script.
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

// Esportata così com'è (non solo eseguita da CLI): il test di idempotenza
// (test/catalogoRealeLotto1.test.js) la richiama direttamente con dati di
// prova, senza toccare Carl Cox/Charlotte de Witte durante `npm test`.
// `connessione` deve essere una connessione dedicata (`pool.getConnection()`),
// non il pool condiviso: in modalità --applica questa funzione apre e
// chiude la transazione da sola (vedi sotto), e serve una connessione
// singola perché la transazione resti la stessa per tutte le query. Così
// UN'INTERRUZIONE A METÀ (un errore su un qualunque INSERT, o il processo
// che muore) lascia il database o del tutto invariato (rollback esplicito
// se l'errore viene intercettato qui; rollback automatico di MySQL sulla
// connessione interrotta se il processo muore senza che questo catch
// giri) — mai a metà con solo alcune righe scritte.
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
            // Modalità anteprima e artista non ancora esistente: non c'è
            // un id da usare per genere/album/brani, si segnala e basta.
            risultati.push({
                tipo: 'genere',
                nome: `${voce.nome} → ${voce.genereNome}`,
                esito: 'da associare (anteprima, dipende dall’artista sopra)',
            });
            if (voce.album) {
                risultati.push({
                    tipo: 'album',
                    nome: voce.album.titolo,
                    esito: 'da inserire (anteprima, dipende dall’artista sopra)',
                });
                for (const brano of voce.album.brani) {
                    risultati.push({
                        tipo: 'brano',
                        nome: brano.titolo,
                        esito: 'da inserire (anteprima, dipende dall’artista sopra)',
                    });
                }
            }
            continue;
        }

        const genere = await assicuraGenere(
            connessione,
            artista.id,
            voce.genereNome,
            applica,
        );
        risultati.push({
            tipo: 'genere',
            nome: `${voce.nome} → ${voce.genereNome}`,
            ...genere,
        });

        if (!voce.album) {
            continue;
        }

        const album = await assicuraAlbum(
            connessione,
            artista.id,
            voce.album,
            applica,
        );
        risultati.push({ tipo: 'album', nome: voce.album.titolo, ...album });

        for (const brano of voce.album.brani) {
            const risultatoBrano = await assicuraBrano(
                connessione,
                artista.id,
                album.id,
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
}

module.exports = {
    LOTTO,
    assicuraArtista,
    assicuraGenere,
    assicuraAlbum,
    assicuraBrano,
    applicaLotto,
};

// Solo quando lanciato da CLI (node scripts/importaCatalogoRealeLotto1.js):
// il require da test/catalogoRealeLotto1.test.js non deve toccare il pool
// applicativo né stampare nulla.
if (require.main === module) {
    (async () => {
        console.log(
            APPLICA
                ? 'MODALITÀ: applicazione scritture'
                : 'MODALITÀ: sola anteprima, nessuna scrittura',
        );
        console.log('');

        // Connessione dedicata (non il pool condiviso): applicaLotto ne ha
        // bisogno per aprire/chiudere la transazione al suo interno (vedi
        // il commento sopra la sua definizione).
        const connessione = await pool.getConnection();
        try {
            const risultati = await applicaLotto(connessione, LOTTO, APPLICA);
            console.table(risultati);
        } catch (errore) {
            // Il rollback (se APPLICA) è già stato fatto dentro
            // applicaLotto prima di rilanciare l'errore qui.
            console.error('Import fallito:', errore.message);
            process.exitCode = 1;
        } finally {
            connessione.release();
            await pool.end();
        }
    })();
}
