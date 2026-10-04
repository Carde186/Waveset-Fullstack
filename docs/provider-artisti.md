# Provider artisti: Deezer, Apple Music e presenza Ticketmaster

Il flusso corrente è **Deezer = artisti (predefinito); Apple Music = alternativa opzionale; Ticketmaster = eventi; Ollama = futura validazione automatica**. Questa guida sostituisce la precedente scelta di Apple come fonte unica. I profili esterni selezionati dall'ADMIN sono salvati separatamente dal catalogo locale: nessuna modifica automatica a nome, bio, generi locali, approvazioni eventi o attraction confermate. Ollama è implementato nel worker eventi in questo incremento.

## Configurazione e client

- `ARTISTI_PROVIDER=deezer` per impostazione predefinita; unico altro valore valido `apple_music`. Un valore sconosciuto restituisce `503 PROVIDER_CONFIGURAZIONE`, senza fallback silenzioso. La scelta è server e richiede la ricreazione del container backend dopo la modifica dell'ambiente.
- `DEEZER_TIMEOUT_MS=8000`, facoltativo, intervallo `10..30000`, per tentativo e lettura del corpo. L'API pubblica non richiede chiave né OAuth.
- Per Apple restano valide tutte le variabili e la firma ES256 descritte in [apple-music.md](apple-music.md). Credenziali e Developer Token rimangono esclusivamente server.
- Il controllo usa `TICKETMASTER_API_KEY` già configurata nel backend. Chiave mancante, HTTP fallito, timeout, JSON invalido o paginazione incompleta producono `non_verificato`.

Il nuovo adapter `backend/src/deezer/client.js` espone `cerca(nome)` e `dettaglio(externalId)`, come il client Apple. Usa solo GET verso `https://api.deezer.com/search/artist` (massimo 10 risultati) e `/artist/:id`. Un solo retry per rete/timeout, HTTP 429/5xx o quota Deezer nel corpo (`error.code=4`); nessun retry per 404, altri 4xx, payload invalido. Un `Retry-After` superiore a un secondo viene rispettato interrompendo il retry: l'ADMIN riprova più tardi. Corpo massimo 1 MiB, URL HTTPS di catalogo/immagine validati, errori remoti mai esposti o loggati.

Il limitatore locale accetta al massimo 8 chiamate al secondo, includendo dettagli e retry. Le ricerche hanno cache in memoria per 60 secondi, massimo 100 voci e coalescenza delle richieste identiche contemporanee. Le copie restituite sono isolate. Limite e cache sono per processo backend: prima di aumentare il numero di repliche valutare un limite condiviso. Il dettaglio viene sempre riletto al momento della conferma o della sync, senza usare il payload inviato dal browser.

## Profilo e immagini

Profilo normalizzato pubblico:

```json
{
  "provider": "deezer",
  "externalId": "3951",
  "name": "Carl Cox",
  "url": "https://www.deezer.com/artist/3951",
  "fan": 232709,
  "artwork": { "url": "https://cdn-images.dzcdn.net/...", "width": 250, "height": 250 },
  "immagine": "https://cdn-images.dzcdn.net/...",
  "genres": [],
  "storefront": "",
  "syncedAt": "2026-10-04T09:06:00.000Z"
}
```

I valori fan sono uno snapshot, non una misura Waveset. `raw` è conservato soltanto nel DB, mai nelle API pubbliche o ADMIN. `storefront=''` identifica il catalogo globale Deezer e mantiene l'unicità `(provider, external_id, storefront)`; Apple mantiene lo storefront scelto. Il vincolo `(artista_id, provider)` assicura un solo link corrente per artista e provider. Apple e Deezer possono coesistere e il cambio del provider non elimina i dati dell'altro.

Preferenza immagine: `picture_medium` (250 px), poi big, xl, small e picture. È una foto dell'artista, mai una copertina album. Mancanza dell'immagine: `artwork=null`, placeholder esistente; mancanza di fan: `fan=null`. I generi sono salvati solo se presenti come array o `genres.data`, altrimenti `[]`; nessuna inferenza da album o brani.

La sola integrazione negli eventi pubblici è la scelta di `lineup[].immagine_url`: immagine del provider attivo, poi immagine locale, poi segnaposto. La priorità è risolta soltanto in `backend/src/artistiProvider/immagini.js`, condiviso da tutte le API pubbliche. Nessun fallback automatico all’altro provider. I marker esistenti continuano a usare il primo artista della lineup e le dimensioni già previste, circa 40 px. Non cambia la logica di Maps, selezione, filtri o ritorno dal dettaglio.

## Migrazioni e avvio

`14_apple_music_provider_schema.sql` resta valido e non viene alterato. `15_artista_ticketmaster_presenza_schema.sql` contiene **solo un CREATE TABLE IF NOT EXISTS**, senza DROP, DELETE o ALTER delle tabelle esistenti. La nuova tabella ha PK/FK `link_id` verso `artista_provider_link` (ON DELETE CASCADE), identità external_id/storefront, esito JSON e timestamp DATETIME(3).

Lo script `preparaAppleMusic.js`, mantenuto per compatibilità, applica entrambi i file con un lock MySQL condiviso. Nuovo nome npm `npm run artisti:provider-schema`; il vecchio `artisti:apple-schema` resta un alias compatibile. Il servizio Compose `apple-music-schema` conserva il nome e viene atteso dal backend.

Prima di aggiornare un DB in uso: fare un backup protetto, leggere i due SQL e applicare la migrazione autorizzata. Dalla root:

```sh
docker compose --env-file .env -f docker-compose.yml build backend apple-music-schema
docker compose --env-file .env -f docker-compose.yml run --rm --no-deps apple-music-schema
docker compose --env-file .env -f docker-compose.yml run --rm --no-deps apple-music-schema
docker compose --env-file .env -f docker-compose.yml up -d --no-deps backend
```

Per test usare `.env.test`, `docker-compose.test.yml` e `-p waveset-test`. Non avviare seed o `admin-init`. Ripetere il job è innocuo: tutte le DDL usano IF NOT EXISTS e non modificano i collegamenti già presenti. In un DB nuovo l'ordine è schema catalogo → tabella 14 → tabella 15.

## API ADMIN e flusso UI

Tutte le route sotto `/api/admin/artisti` richiedono sessione ADMIN; POST conservano CSRF e controllo dell'origine esistenti. Risposte `Cache-Control: no-store`.

| Metodo e percorso | Contratto |
| --- | --- |
| `GET /provider` | `{provider:"deezer"}` oppure `apple_music` |
| `GET /:id/provider` | `{provider, artista:{id,nome,immagine_url}, collegamento:profilo oppure null}` del provider attivo |
| `GET /:id/deezer` | Stesso contratto, profilo Deezer |
| `GET /:id/deezer/search?q=nome` | `{provider, risultati:[profili]}`, senza scritture |
| `POST /:id/deezer/collegamento` | `{external_id:"3951", versione_attesa:null}` per primo link; versione corrente per sostituire |
| `POST /:id/deezer/sincronizza` | `{versione_attesa:1}`, aggiorna solo l'ID già scelto |
| `POST /:id/deezer/ticketmaster` | `{versione_attesa:1}`, ricontrolla solo la presenza |

Le stesse route sono disponibili con prefisso `/:id/apple-music`; tutte le API Apple precedenti restano valide. I profili collegati aggiungono `versione` e `ticketmaster`. La conferma rilegge i metadati dal provider, salva in transazione con versione attesa e poi controlla Ticketmaster. Una conferma concorrente obsoleta restituisce 409. I deadlock InnoDB ripetono al massimo due volte la sola transazione, senza rifare richieste al provider.

`/admin/artisti` elenca solo artisti locali e mostra il provider attivo. `/admin/artisti/:id` mostra il profilo corrente, cerca risultati con foto/fan/generi disponibili/link, richiede selezione e conferma esplicita, consente sostituzione controllata e sync. I testi sono IT/EN (`provider.*`); gli errori specifici Apple restano `apple.error.*`. Nessun risultato di ricerca crea un nuovo artista Waveset.

## Presenza Ticketmaster informativa

Ricerca attraction con `keyword=nome` del profilo selezionato, non eventi. Confronto del nome completo: minuscolo, senza accenti, spazi o punteggiatura. Budget: 5 secondi complessivi, timeout per chiamata 3 secondi, nessun retry, massimo 3 pagine/3 richieste, pausa 300 ms. Se la ricerca non si completa l'esito è `non_verificato`, mai una falsa assenza.

```json
{
  "stato": "trovato",
  "attractions": [{ "id": "K8vZ9175vGf", "name": "Carl Cox" }],
  "ambiguo": false,
  "controllatoAt": "2026-10-04T09:06:00.090Z"
}
```

- Zero corrispondenze esatte: `non_trovato`, array vuoto.
- Una o più corrispondenze esatte: `trovato`, tutte conservate; con più ID `ambiguo=true` e avviso ADMIN. Nessuna scelta arbitraria.
- Fallimento fonte: `non_verificato`, array vuoto, data del tentativo. Il collegamento artistico resta confermato.
- Link storico mai controllato: `non_verificato`, data null. Se fallisce la persistenza del solo esito dopo la conferma, il profilo resta salvato e viene restituito non verificato con data null; ripetere dal pulsante.

**La presenza di un'attraction non dimostra che esistano eventi futuri né conferma l'identità artistica.** I tre badge richiesti sono accompagnati da questa spiegazione. `Nessun evento disponibile su Ticketmaster` indica in questo pannello l'assenza di un'attraction con nome esatto; non è un controllo dell'inventario eventi. Usare **Ricontrolla Ticketmaster** per un nuovo tentativo. Il risultato non modifica `artista.id_ticketmaster`, la coda eventi o le decisioni ADMIN. La revisione eventi esistente rimane il flusso di conferma.

Il salvataggio dell'esito verifica ID/storefront/versione del link con lock: una risposta tardiva non può sovrascrivere l'esito di un link sostituito. Una sostituzione invalida l'esito precedente nella stessa transazione. La sync dello stesso ID conserva l'esito fino al ricontrollo.

## Verifiche e limiti

I test standard usano HTTP mockato: client Deezer, errori e cache/limite, Ticketmaster, selezione del provider, API ADMIN, frontend IT/EN e persistenza MySQL test con sole fixture temporanee ripulite. Nessuna chiamata reale alle fonti nei test standard.

Prova manuale in sola lettura del 4 ottobre 2026: Deezer Carl Cox ID `3951` e Charlotte de Witte ID `5384533`. Entrambi hanno `picture`, small, medium, big e xl; scelta medium250×250; nessun campo generi presente. Ticketmaster ha restituito una sola attraction con nome esatto per ciascuno: `K8vZ9175vGf` e `K8vZ917pnWV`. La ricerca Deezer ha mostrato omonimi, quindi la conferma esplicita resta necessaria. Non sono stati collegati automaticamente artisti reali né create sessioni/follow per la prova.

Prima del lancio pubblico leggere le [condizioni d'uso ufficiali Deezer](https://developers.deezer.com/termsofuse), in particolare vincoli d'uso, diritti sulle immagini e destinazione commerciale dell'app. La disponibilità gratuita dell'API pubblica non costituisce una licenza generale per riutilizzare fotografie. Valutare e documentare gli obblighi applicabili; non inventare attribuzioni o licenze. Apple live resta subordinato alle credenziali server e Ollama resta futuro.

## Immagini pubbliche e fallback

Campo canonico nelle API artista/elenco/ricerca e nelle lineup di `/api/eventi`, `/api/eventi/:id` e Novità: `immagine_url`, già risolto dal backend con priorità **provider attivo → precedente foto locale → null**. Il frontend lo normalizza in `immagineUrl`. I contratti già camelCase di brano/album/Novità mantengono `artista.immagineUrl` con la stessa regola; le copertine album non cambiano. Una query batch legge i link del solo provider attivo; ordine, filtri e duplicazione per evento rimangono invariati. Nessuna chiamata Deezer nel percorso di lettura, nessuna scrittura nel catalogo.

Le API elenco/dettaglio artista aggiungono `immagine_provider` (nome provider o null) per la provenienza. Se viene scelta la foto provider, `credito_immagine` del dettaglio è null: i crediti di una vecchia foto locale non devono essere attribuiti alla nuova. Raw, segreti e campi ADMIN non sono esposti. Il flusso di revisione e la persistenza dei profili restano invariati.

Esplora e pagina artista usano `ArteCatalogo`; lista e dettaglio evento lo riusano per le foto della lineup, mantenendo l’ordine esistente. La foto non dipende dalla presenza di crediti. Immagine assente o non caricabile: grafica Club esistente. I marker mantengono iniziale deterministica, immagine36px/cerchio40px e fallback su errore; foto inviate senza referrer come nel pannello ADMIN. Nessuna CSP immagini è configurata attualmente; i validatori URL HTTPS ammettono `cdn-images.dzcdn.net` e Chrome ne verifica il caricamento.
