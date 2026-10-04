# Apple Music Catalog: collegamenti ADMIN

Apple Music Catalog API è il provider artisti opzionale: il default corrente è Deezer, descritto in [provider-artisti.md](provider-artisti.md). Le API e la configurazione Apple di questa guida restano valide. Ticketmaster è la fonte degli eventi. Ollama, in un incremento futuro, userà il profilo Apple normalizzato per aiutare a validare l'identità artista ↔ attraction; non è una fonte di dati artistici e non è implementato qui.

Questa integrazione lavora soltanto sugli artisti Waveset già esistenti. Non importa nuovi artisti automaticamente, non implementa Spotify, iTunes Search, librerie personali, playback, playlist Apple personali, Music User Token o MusicKit nel browser. Le mappature legacy del catalogo restano invariate.

## Chiave e configurazione server

Serve l'adesione all'Apple Developer Program e una chiave abilitata a MusicKit. Nel portale Apple, un Account Holder/ADMIN registra un Media ID, abilita MusicKit, crea una chiave Media Services e la associa all'identificatore. Conservare privatamente il file `.p8` scaricato; ricavare Key ID dal dettaglio della chiave e Team ID dall'account. Seguire la [procedura ufficiale per identificatore e chiave](https://developer.apple.com/help/account/capabilities/create-a-media-identifier-and-private-key/).

Impostare in `.env` (sviluppo) o `.env.test` (test), entrambi non versionati:

| Variabile | Uso |
|---|---|
| `APPLE_MUSIC_TEAM_ID` | Team ID Apple, 10 caratteri alfanumerici maiuscoli |
| `APPLE_MUSIC_KEY_ID` | Key ID della chiave MusicKit, 10 caratteri |
| `APPLE_MUSIC_PRIVATE_KEY` | Contenuto PEM della chiave privata EC P-256 `.p8` |
| `APPLE_MUSIC_STOREFRONT` | Codice storefront, per esempio `it` o `gb`; obbligatorio, nessun default nel client |
| `APPLE_MUSIC_TOKEN_TTL` | Durata JWT in secondi, default `3600`, intervallo `60..15777000` |
| `APPLE_MUSIC_TIMEOUT_MS` | Timeout per tentativo, inclusa lettura del corpo, default `10000`, intervallo `10..60000` |

Il PEM può essere racchiuso tra apici singoli, su più righe oppure con sequenze letterali `\n`. Inserire il contenuto con un editor locale, senza comandi che lo stampino. Il valore vuoto negli example è intenzionale. I valori arrivano esclusivamente al container **backend**: nessun build argument, variabile `VITE_*` o endpoint espone chiave, identificatori o token. Dopo una modifica o rotazione delle credenziali ricreare il backend; non stampare `docker compose config` o gli header HTTP.

La configurazione è verificata al primo utilizzo Apple. Se manca o la chiave è errata, ricerca/conferma/sync rispondono `503 APPLE_CONFIGURAZIONE`; il catalogo locale e la lettura dei collegamenti salvati restano disponibili.

`backend/src/appleMusic/token.js` genera lato server un JWT **ES256**, firma ECDSA P-256/SHA-256 in formato JOSE a 64 byte: header `alg/kid`, payload `iss/iat/exp`. Il token resta esclusivamente in memoria e viene riusato; rinnovo anticipato entro 30 secondi dalla scadenza (15 con TTL minimo). Non si inviano claim App Store (`aud`/`bid`) o Music User Token. Su `401/403` la cache viene invalidata per la richiesta successiva. Riferimento: [Developer Token Apple Music](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).

## Migrazione e avvio

Fonte di verità: `backend/db/init/14_apple_music_provider_schema.sql`. Crea soltanto `artista_provider_link` con `CREATE TABLE IF NOT EXISTS`; nessun `ALTER`, `DROP`, `DELETE` o aggiornamento delle tabelle esistenti. Su volume vuoto l'entrypoint MySQL applica la migrazione insieme allo schema. Sui volumi già esistenti, effettuare prima un backup protetto e leggere l'anteprima SQL.

Il nuovo servizio Compose `apple-music-schema` applica il file idempotentemente con lock MySQL; `backend` ne attende il completamento. Per un DB di sviluppo già avviato, dalla root:

```sh
cat backend/db/init/14_apple_music_provider_schema.sql
docker compose --env-file .env -f docker-compose.yml build backend apple-music-schema
docker compose --env-file .env -f docker-compose.yml run --rm --no-deps apple-music-schema
docker compose --env-file .env -f docker-compose.yml up -d --no-deps backend
```

Non avviare `admin-init` o seed per questo aggiornamento. Per test usare `.env.test` e `docker-compose.test.yml` con la stessa sequenza; il DB resta `waveset_test`. In alternativa, da `backend/`, con `DB_*` già configurate: `npm run artisti:apple-schema`. Nessun segreto va passato come argomento shell. Lo script richiede `--applica` (incluso nello script npm).

La tabella archivia `provider`, identità esterna/storefront, URL e immagine, profilo normalizzato JSON, risorsa Apple originale JSON, data di sync, timestamp di creazione/aggiornamento e `versione`. Vincoli univoci `(provider, external_id, storefront)` e `(artista_id, provider)`; FK verso `artista`, con cascata solo se viene eliminato l'artista locale. Non si cambia `artista.id_ticketmaster`. Per artista/provider c'è una sola riga corrente: una sostituzione esplicita aggiorna quella riga, non mantiene uno storico.

## Flusso ADMIN e contratto HTTP

Login ADMIN → **Gestione artisti** (`/admin/artisti`) → artista locale (`/admin/artisti/:id`). È disponibile anche un link dalla pagina pubblica dell'artista, visibile solo all'ADMIN.

La pagina mostra il collegamento corrente e l'ultima sync; permette una ricerca esplicita per nome (massimo 10 risultati, tipo `artists`), foto artista, generi, ID/storefront e link Apple Music. Selezionare il risultato, scegliere **Verifica collegamento**, leggere il riepilogo e **Conferma e salva**. Se esiste già un link compare un avviso di sostituzione. **Risincronizza metadati** rilegge esclusivamente l'ID/storefront già confermati; nessuna ricerca per nome può ricollegare silenziosamente l'artista.

Tutti questi endpoint richiedono sessione ADMIN; le POST browser richiedono anche Origin/CSRF esistenti. Risposte `Cache-Control: no-store`.

| Metodo / endpoint | Contratto |
|---|---|
| `GET /api/admin/artisti/:id/apple-music` | `{artista:{id,nome,immagine_url}, collegamento:profiloConVersione oppure null}` |
| `GET /api/admin/artisti/:id/apple-music/search?q=nome` | `{risultati:[profiloPubblico]}`; non salva e non conferma |
| `POST /api/admin/artisti/:id/apple-music/collegamento` | Body `{external_id:"123",versione_attesa:null}` per primo collegamento; usare la versione corrente per sostituirlo. Il server rilegge il dettaglio da Apple. Ritorna il profilo con nuova versione. |
| `POST /api/admin/artisti/:id/apple-music/sincronizza` | Body `{versione_attesa:1}`; ritorna il profilo con nuova versione |

Profilo pubblico (esempio sintetico, nessuna credenziale):

```json
{
  "externalId": "123",
  "name": "Artista",
  "url": "https://music.apple.com/it/artist/artista/123",
  "artwork": null,
  "genres": ["Electronic"],
  "storefront": "it",
  "syncedAt": "2026-10-03T10:00:00.000Z"
}
```

Artwork presente: `{url,width,height}` con URL derivato dall'artwork **dell'artista** a 300×300; nessun ripiego su album, brani o immagini inventate. Artwork mancante: `null`, placeholder con iniziale in ADMIN. Il client valida URL HTTPS Apple Music/mzstatic e il frontend valida nuovamente le risposte.

`GET /api/artisti/:id` aggiunge il campo retrocompatibile `apple_music` (profilo pubblico o `null`): niente raw, versione interna, credenziali o header. Nessun cambiamento alla UI pubblica degli eventi. Il raw della risorsa artista rimane soltanto nel DB per future verifiche backend/Ollama; non si salvano header HTTP.

Errori `{codice,messaggio}`: `400 APPLE_PARAMETRI`, `401/403` sessione/ruolo, `404 ARTISTA_NON_TROVATO/APPLE_NON_TROVATO/APPLE_LINK_ASSENTE`, `409 APPLE_CONFLITTO/APPLE_GIA_COLLEGATO`, `503 APPLE_CONFIGURAZIONE/APPLE_TIMEOUT/APPLE_RETE/APPLE_LIMITE/APPLE_TEMPORANEO`, `502 APPLE_AUTORIZZAZIONE/APPLE_DATI_INVALIDI/APPLE_RISPOSTA`, `500 APPLE_SERVER`. Il frontend usa testi IT/EN locali, non mostra errori interni ricevuti da Apple o MySQL.

## Sincronizzazione sicura e limiti

- Il client chiama soltanto `GET /v1/catalog/{storefront}/search?types=artists` e `GET /v1/catalog/{storefront}/artists/{id}` su host Apple fisso. Nessun redirect e nessun URL browser usato come destinazione backend.
- Timeout con AbortController e corpo limitato a 1 MiB. Al massimo due tentativi GET su rete/timeout, `429` o `5xx`, con attesa breve e `Retry-After` rispettato. Se Apple chiede oltre un secondo di attesa, la richiesta termina e l'ADMIN riprova più tardi. Nessun retry su altri `4xx`, dati incompleti o JSON errato.
- Dati incompleti, artista rimosso, fonte non disponibile o errore SQL non cancellano il collegamento/snapshot precedente. Un lock della riga artista e la versione attesa rendono atomici salvataggio e sostituzione; conferme o sync concorrenti obsolete ricevono `409`.
- Nome, bio, immagini, generi locali e conferme Ticketmaster non vengono sovrascritti: i metadati ufficiali sono nel profilo provider separato. Non si creano eventi o utenti con questo flusso.
- In questa iterazione la sincronizzazione Apple è **manuale tramite ADMIN**; non viene aggiunto uno scheduler Apple e non si promettono dati in tempo reale. Nessuna conferma automatica per omonimi. Ollama resta futuro.

## Verifica riproducibile

Da `backend/`:

```sh
node --test test/appleMusicSenzaDb.test.js test/appleMusicApiSenzaDb.test.js test/followSenzaDb.test.js
node --env-file=../.env.test --test test/appleMusicPersistenza.test.js
```

Il primo comando usa chiavi EC generate in memoria, HTTP mockato e sessioni/DB simulati; il secondo usa **solo `waveset_test`**, due artisti temporanei e Apple HTTP mockato, poi elimina esclusivamente i propri artisti/link. Non servono credenziali Apple e non si chiama Apple nei test standard. Si verificano firma/cache/rotazione, risposte `401/429/5xx`, timeout, JSON/dati incompleti, ruoli e CSRF, persistenza, unicità, rollback, versioni e concorrenza. Test frontend: `src/schermate/AdminArtisti.test.tsx`, traduzioni in `src/localizzazione/it.json` e `en.json` (chiavi `apple.*`).

Da `frontend/`: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Per la prova live, dopo aver configurato privatamente la chiave, cercare un artista conosciuto, confermarlo, ricaricare, sincronizzarlo e provare una sostituzione consapevole; la prova Apple reale è distinta dai test mockati.

Riferimenti: [ricerca Catalog artists](https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type)), [dettaglio artista](https://developer.apple.com/documentation/applemusicapi/get-a-catalog-artist), [Apple Music API](https://developer.apple.com/documentation/applemusicapi/).
