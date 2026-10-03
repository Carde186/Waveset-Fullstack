# Waveset — frontend web

Il frontend comprende accesso, registrazione, area, catalogo locale, `/eventi` e `/eventi/:id` nello stile «Club». La mappa Google funziona quando sono configurati chiave browser e Map ID. Playlist, ricerca Apple live, ADMIN e AI web restano incrementi successivi.

## Eventi e Google Maps

- `/eventi` legge `GET /api/eventi?filtro=tutti` anche per gli ospiti. Il pulsante «Artisti che seguo» imposta `?filtro=seguiti`, richiede la sessione browser e legge `GET /api/eventi?filtro=seguiti`. La selezione è nell'URL; i link diretti e la navigazione indietro del browser funzionano. `/eventi/:id` legge `GET /api/eventi/:id`, pubblico.
- Il backend pubblica eventi da oggi in poi, ordinati per data e ora, e include il lineup degli artisti locali. `data_evento` è il giorno locale del locale in `YYYY-MM-DD`: le tre query della sola route eventi usano `DATE_FORMAT` per impedire che mysql2 e JSON lo convertano in un istante UTC. `ora_evento` rimane l'ora locale separata. La pagina valida date, orari, lineup, ID e coordinate. Un evento senza coordinate resta nell'elenco.
- Le quattro modalità sono Standard (`roadmap`), Scura (`roadmap` con `ColorScheme.DARK`), Satellite (`satellite`) e Ibrida (`hybrid`). La modalità si salva in localStorage sotto `waveset.eventi.modalitaMappa`; è l'unico dato della funzione salvato lì. Il passaggio a/dalla Scura ricrea la mappa conservando centro, zoom e selezione, perché Google applica `colorScheme` solo alla creazione.
- Ogni evento con coordinate ha un AdvancedMarkerElement personalizzato: foto profilo `lineup[0].immagineUrl`, già fornita dall'API come `immagine_url`, senza endpoint o campi nuovi. Il primo artista della lineup è il principale per convenzione: il backend ordina alfabeticamente e non espone un ruolo headliner. La foto è ritagliata a cerchio (36 px, bordo 40 px, area cliccabile 44 px); URL assente, escluso dal catalogo o foto non raggiungibile mostrano l'iniziale maiuscola su verde profondo con testo lime, sempre gli stessi colori Club. Senza lineup compare una nota musicale. Ogni evento ha un nodo distinto anche con lo stesso artista; l'URL della foto resta quello del catalogo, senza trasformazioni o richieste di ricerca esterne.
- I marker avanzati sono collegati alla lista: il click (anche da tastiera) seleziona e porta il focus alla carta corrispondente, poi apre `/eventi/:id?filtro=...`; il ritorno conserva il filtro. Dalla carta si seleziona il marker senza aprire il dettaglio. Bordo chiaro e ombra staccano l'avatar da tutti i layer; selezione, hover e focus aggiungono un anello lime. Lista e dettagli restano utilizzabili se la configurazione manca, il loader fallisce, Google rifiuta l'autenticazione o la mappa supera il timeout. I controlli sono accessibili tramite tastiera; su schermi stretti mappa e lista si dispongono in colonna. Riferimento: [marker HTML/CSS di Google](https://developers.google.com/maps/documentation/javascript/advanced-markers/html-markers).

Per lo sviluppo Vite copia `frontend/.env.example` in `frontend/.env.local` e imposta `VITE_GOOGLE_MAPS_API_KEY` e `VITE_GOOGLE_MAPS_MAP_ID` **solo nel file locale ignorato da Git**. Per il Compose di test imposta le stesse variabili nel `.env.test` locale prima della build: il Compose le passa come build args al Dockerfile. Dopo un cambio ricostruisci l'immagine frontend. Senza valori la lista eventi funziona e spiega perché non mostra la mappa.

In Google Cloud occorrono un progetto con fatturazione abilitata, la **Maps JavaScript API** attiva, una chiave browser con restrizione alla sola API e ai referrer HTTP esatti usati dall'app (per esempio `http://localhost:5173/*`, `http://localhost:5174/*` e i domini HTTPS previsti), e un **Map ID JavaScript** per gli Advanced Markers. La chiave browser sarà visibile nel bundle: limita referrer e API e controlla quote e spesa nel progetto Cloud. La chiave server opzionale della Geocoding API è distinta e non va nel frontend. Fonti Google: [caricamento della API](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [Advanced Markers e Map ID](https://developers.google.com/maps/documentation/javascript/advanced-markers/start), [modalità scura](https://developers.google.com/maps/documentation/javascript/mapcolorscheme), [fatturazione](https://developers.google.com/maps/documentation/javascript/usage-and-billing).

I test Vitest simulano il backend e Google Maps. Per i marker personalizzati sono passati 207 test frontend, lint, typecheck e build; è stato ricostruito solo il frontend test e verificato con Chrome e SDK Google reale su `http://localhost:5174`, desktop e viewport mobile, sui quattro layer e con preferenze browser chiaro/scuro (l'app ha il tema Club scuro). Nel catalogo test ci sono soltanto segnaposto Picsum, quindi i marker reali mostrano le iniziali; caricamento immagini, ripetizione dello stesso artista e immagine 404 sono stati verificati con risposte simulate nel browser. Il filtro seguiti è stato verificato anche con la sessione esistente, simulando soltanto un evento nella lista reale vuota. Nessuna scrittura di dati o modifica alla configurazione Google.

## Configurare Google Maps in locale

1. Aprire [Google Cloud Console](https://console.cloud.google.com/).
2. Selezionare o creare il progetto Google Cloud `wavesetFullstack`.
3. Andare in **API e servizi → Libreria**.
4. Cercare e abilitare **Maps JavaScript API**. Se non compare, usare la [pagina diretta della Maps JavaScript API](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com), verificando che il progetto corretto sia selezionato.
5. Andare in **API e servizi → Credenziali**.
6. Selezionare **Crea credenziali → Chiave API**.
7. Dare alla chiave un nome riconoscibile, per esempio `waveset-maps-test`.
8. Limitare l'applicazione a **Siti web** / **Referenti HTTP**.
9. Aggiungere questi referer per il test locale: `http://localhost:5174` e `http://localhost:5173`. Se la console lo richiede, usare `http://localhost:5174/*` e `http://localhost:5173/*`.
10. Limitare la chiave alla sola **Maps JavaScript API**.
11. Salvare senza riportare nella documentazione il valore della chiave.
12. Creare il Map ID da **Google Maps Platform → Gestione mappe**, con nome `waveset-test-web`, piattaforma **JavaScript** e tipo **Raster** oppure **Vector**.
13. Creare `frontend/.env.local`, che non deve essere committato, con questi segnaposto da sostituire soltanto nel file locale:

    ```dotenv
    VITE_GOOGLE_MAPS_API_KEY=...
    VITE_GOOGLE_MAPS_MAP_ID=...
    ```

14. Dalla radice del repository, verificare che il file sia ignorato:

    ```bash
    git check-ignore -v frontend/.env.local
    ```

15. Riavviare Vite dopo aver creato o modificato `.env.local`.

Avvertenze:

- Non inserire chiavi o Map ID reali nei file versionati.
- Non usare la chiave server del backend nel browser.
- La chiave browser è visibile nel frontend e va protetta con referer HTTP e restrizioni API.
- Non usare come Map ID il numero progetto, l'ID progetto, il nome della chiave o la chiave API.
- La fatturazione Google Cloud e la Maps JavaScript API devono essere abilitate.
- Il test reale usa **http://localhost:5174**.

`frontend/.env.local` configura lo sviluppo Vite su `http://localhost:5173`. Il frontend del Compose di test su `http://localhost:5174` legge invece queste variabili dal `.env.test` locale durante la build: modificare `.env.local` e riavviare Vite non aggiorna quella build. Per il Compose occorre ricostruire l'immagine frontend dopo aver impostato le variabili in `.env.test`, mantenendo entrambi i file fuori dai commit.

## Esplora locale e dettagli (verificati sull'host)

Le nuove pagine pubbliche sono `/esplora`, `/artisti/:id`, `/brani/:id` e `/album/:id`. La voce Esplora è disponibile nella barra anche senza sessione; il comportamento delle pagine di accesso e Area resta quello precedente.

- Esplora legge `/api/generi` e `/api/artisti?genere_id=…`. Il genere filtra soltanto l'elenco degli artisti, mentre la ricerca `/api/ricerca?q=…` consulta tutto il catalogo locale, con sezioni Artisti e Brani.
- Ricerca da 2 a 100 caratteri, debounce di 300 ms, caricamento, errore/riprova e risultati vuoti. Le risposte superate vengono ignorate anche dopo cambio filtro, cambio ID, svuotamento, smontaggio o ritorno a una ricerca precedente.
- I dettagli collegano soltanto artista, album e brani effettivamente presenti nella risposta. Gestiscono 404, campi nulli, brani senza album, featuring separati e liste vuote. Gli eventi dell'artista collegano al dettaglio evento.
- Il modulo `src/api/catalogo.ts` valida le risposte e normalizza snake_case/camelCase. Usa il client HTTP esistente, sempre sulla stessa origine, con sole GET per il catalogo.
- I link Apple alle tracce e Spotify agli album usano le mappature backend esistenti; un 404 significa link assente, un guasto permette una riprova separata. Non viene chiamata la copertina iTunes live e non sono implementate ricerca Apple live o nuove integrazioni.
- Card e sfondi usano i gradienti e il lime Club. Le immagini Picsum non vengono mostrate: il fallback è grafica astratta dichiarata. Le foto artista vengono mostrate nel dettaglio soltanto con crediti; i link attivi sono limitati a URL HTTPS ammessi.

**Verifica precedente di Esplora:** lint, typecheck, 156 test frontend in 10 file e build passati sull'host. I test simulavano le API, senza Docker, DB o chiamate a servizi esterni. La verifica Compose descritta sotto riguarda l'incremento di autenticazione.

## Stack e scelte

- **Vite + React 19 + TypeScript**, routing con `react-router`.
- **CSS: variabili CSS + CSS Modules, senza librerie.** Nessuna dipendenza di stile (NativeWind non è richiesto), nessun font esterno (Arial/Helvetica come nell'anteprima). Motivo: i token Club sono pochi e fissi, i moduli isolano gli stili per componente e non serve altro.
- **Sessione: cookie HttpOnly + CSRF.** Il browser custodisce il cookie `waveset_sid` (JavaScript non lo vede). Il token CSRF arriva nella risposta di `web/login` e di `/auth/io` e vive **solo in memoria del modulo** `src/api/client.ts`. Solo la preferenza di visualizzazione Maps va in localStorage; nessuna credenziale o token va nello storage. Le richieste usano `credentials: 'same-origin'`; il codice **non imposta mai** `Origin` né `Cookie` (lo fa il browser).
- **Test:** Vitest + Testing Library (jsdom).

## Origine dei colori e cosa è «composto»

I token (`src/stile/token.css`) vengono dall'anteprima approvata `waveset-club-anteprima-schermate.html`, che sta **fuori dal repository**. Un test verifica che nessun colore CSS esca dalla palette dell'anteprima.

L'anteprima **non contiene** le schermate di accesso/registrazione, gli stati di caricamento/errore/vuoto né un colore di errore. Sono composti solo con componenti e palette approvati (card a gradiente, arte lime, pillola lime). Gli errori usano un'etichetta «Errore», un filetto lime più spesso a sinistra e `aria-invalid`, **non** un rosso inventato. Sono elementi da confermare.

## Avvio nel Compose di test (verificato)

Il **1 ottobre 2026** il frontend è stato costruito e provato con Chrome reale nel solo progetto `waveset-test`, DB `waveset_test`, volume `waveset_test_mysql_data`. Il backend esistente conteneva lo stesso codice di `backend/src`, quindi non è stato ricostruito. Il volume e il seed di test già completato sono stati riutilizzati; l'avvio completo da clone e volume vuoto non è stato riprovato.

Dalla radice, con `.env.test` già configurato e Docker Desktop disponibile:

```bash
docker info
scripts/preflight.sh test
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test config --quiet
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test build frontend
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --wait --wait-timeout 120 mysql
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --wait --wait-timeout 120 backend frontend
```

Questi avvii con `--no-deps` presuppongono il seed già completato e l'immagine backend verificata; per un primo avvio consultare il README radice. `config --quiet` evita di stampare variabili segrete; nella verifica la configurazione risolta è stata catturata in memoria e mostrata solo nei campi non segreti.

Apri esattamente **http://localhost:5174**. La porta è pubblicata su `127.0.0.1:5174`, ma `http://127.0.0.1:5174` sarebbe un'altra origine e non è stata usata. Il backend di test riceve `FRONTEND_ORIGINS=http://localhost:5174` e `COOKIE_SECURE=false`; questa impostazione HTTP riguarda solo il test. nginx serve la SPA e inoltra `/api/` a `http://backend:3000`, senza CORS o header Origin/Cookie impostati dal frontend. MySQL e frontend sono risultati healthy; il backend, privo di healthcheck Compose, è stato verificato anche tramite `/health` sulla porta 3001.

**Prova browser completata:** registrazione `201`, login `200`, refresh con `/auth/io` `200`, logout `204`, nuovo login e logout-tutti `204`, seconda sessione revocata `401`. Verificati cookie accettato e inviato dal browser, HttpOnly, SameSite=Strict, Path=/api, senza Secure su HTTP, invisibile a `document.cookie`; localStorage/sessionStorage vuoti, Origin effettivo `http://localhost:5174` e CSRF inviato e accettato nei logout. Passati anche login errato `401`, registrazione `429` reale con `Retry-After`, pagina 404 e API `404`.

**503 reale e ripristino, senza modificare `.env.test`:**

```bash
FRONTEND_ORIGINS_TEST='' docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --force-recreate --wait --wait-timeout 60 backend
# Dopo la prova, ripristinare senza override:
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --force-recreate --wait --wait-timeout 60 backend
```

L'override vuoto è stato verificato come unico cambiamento della configurazione. Chrome ha ricevuto `503` sul login e mostrato il messaggio previsto. Dopo il ripristino: Origin effettivo del backend corretto, `/health` positivo e login con credenziali inesistenti di nuovo `401` senza cookie; il flusso valido completo era stato verificato prima dell'override.

Gli ID E2E sono stati registrati. Utenti e sessioni residue delle prove diagnostiche sono stati eliminati dopo SELECT di anteprima, per ID esatti, in transazioni con conteggi verificati; le sessioni della prova completata erano già revocate dai logout. Stato finale: **3 utenti iniziali invariati, 0 sessioni, 0 playlist, 2 follow**. Lo stack normale e Android non sono stati modificati o riavviati; il DB normale non è stato interrogato.

Arresto previsto del solo test, non eseguito durante questa verifica:

```bash
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test stop
```

## Avvio in locale (verifica precedente)

Prerequisiti: Node.js (provato con quello del progetto), MySQL raggiungibile (per esempio quello dello stack Compose di test) e il backend.

Il frontend parla con `/api` sulla **stessa origine** della pagina: in sviluppo il server di Vite inoltra `/api` al backend (proxy), quindi **niente CORS**. Il browser aggiunge da solo l'`Origin` `http://localhost:5173`, che il backend deve avere in `FRONTEND_ORIGINS`.

1. Per lo sviluppo con Vite, avvia un backend locale collegato esclusivamente a `waveset_test`. Il Compose di test ammette di default la porta frontend 5174; questo backend separato ammette invece Vite su 5173. Credenziali lette da `.env.test`, senza riportarle:

   ```bash
   cd backend
   DB_HOST=127.0.0.1 DB_PORT=3308 DB_NAME=waveset_test PORT=3010 \
   FRONTEND_ORIGINS=http://localhost:5173 COOKIE_SECURE=false \
   node --env-file=../.env.test src/server.js
   ```

   Per provare senza toccare dati veri usa lo stack di test (MySQL su 3308, DB `waveset_test`).

2. In un altro terminale:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. Apri **http://localhost:5173** (non `127.0.0.1`: sarebbe un'altra origine, non ammessa).

Se il backend locale di test è su un'altra porta, imposta `API_TARGET` al suo URL prima di `npm run dev`. Se `FRONTEND_ORIGINS` manca, l'accesso mostra il messaggio di sessione browser non disponibile (503). Il flusso locale su Vite 5173 era stato verificato in precedenza; questi comandi locali non sono stati eseguiti in questo incremento.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | server di sviluppo su `localhost:5173` con proxy `/api` |
| `npm run build` | controllo dei tipi + build in `dist/` |
| `npm run preview` | serve la build, con lo stesso proxy |
| `npm test` | test Vitest |
| `npm run lint` / `npm run typecheck` / `npm run format` | ESLint / TypeScript / Prettier |

## Endpoint usati (contratti reali del backend)

| Chiamata | Esito gestito |
|---|---|
| `POST /api/auth/web/login` `{email,password}` | 200 `{utente,csrf}` + cookie; 400, 401 «Email o password errati», 403, 429 (`Retry-After`), 503 sessione web non configurata |
| `GET /api/auth/io` | 200 `{utente,csrf}` (riconoscimento dopo il ricarico); 401 → anonimo |
| `POST /api/auth/logout`, `/api/auth/logout-tutti` | 204 (con `X-CSRF-Token`); 401 → torna all'accesso |
| `POST /api/auth/registrazione` `{nome,email,password}` | 201 (non apre sessione); 400 con `campi` per campo; 409; 429 |
| `GET /api/eventi?filtro=tutti` | 200 array, pubblico; 400 filtro non valido |
| `GET /api/eventi?filtro=seguiti` | 200 array con almeno un artista seguito; 401 senza sessione valida |
| `GET /api/eventi/:id` | 200 oggetto pubblico; 404 assente o non pubblicato |

## Limiti noti

- Registrarsi da un browser che ha ancora un cookie di sessione revocato altrove dà 403 dal backend: il frontend mostra un messaggio controllato, ma la correzione spetta al backend.
- Interfaccia disponibile in italiano e inglese; il frontend è presente nel solo Compose di test. Esplora locale, Eventi e dettagli sono implementati. La mappa richiede configurazione Google; ricerca Apple live, Playlist, ADMIN e AI web restano da implementare.
- I test frontend usano un backend simulato. In questo incremento sono passati lint, typecheck, **96 test** e build sull'host, più la build Docker e la prova reale descritta sopra. Sono passati anche **385 test backend pertinenti**, senza scritture nel DB; la suite backend completa non è stata rieseguita.
- Lo script Chrome/CDP è temporaneo e non incluso nel repository. Le sue asserzioni usano `textContent` per evitare l'effetto del CSS uppercase e consumano i corpi fetch diagnostici senza stamparli; nessuna correzione applicativa è stata necessaria.
- Avvio da clone/volume vuoto, HTTPS e arresto dello stack non verificati in questo incremento. Dietro nginx i rate limit condividono l'IP del proxy perché `trust proxy` resta disattivato.

## Impostazioni account e lingua IT/EN

La voce **Impostazioni** nella navigazione USER apre `/impostazioni`. La pagina richiede una sessione autenticata; ADMIN non dispone dei form. Due form separati chiedono la password corrente e la conferma della nuova email/password. Gli input delle password sono mascherati, non vengono persistiti e vengono svuotati dopo la richiesta. Il cambio email aggiorna anche il profilo visualizzato, senza rifare il login.

| Nuovo endpoint | Corpo JSON | Risposta |
|---|---|---|
| `PATCH /api/auth/email` | `passwordCorrente`, `nuovaEmail`, `confermaEmail` | 200 `{utente}` |
| `PATCH /api/auth/password` | `passwordCorrente`, `nuovaPassword`, `confermaPassword` | 204 |

Entrambi gli endpoint richiedono ruolo USER e le protezioni esistenti della sessione; con cookie sono obbligatori origine ammessa e `X-CSRF-Token`. La password corrente viene verificata con bcrypt. Email normalizzata e vincolo UNIQUE esistente gestiscono l'univocità anche per richieste concorrenti. Nuova password: almeno 12 caratteri Unicode, massimo 72 byte UTF-8, almeno una lettera e un numero o simbolo, nessun NUL; hash bcrypt con costo 12. Nessuna migrazione o modifica ai contratti esistenti di login/registrazione.

Gli errori account usano codici controllati: 400 `INVALID_INPUT` con codici per campo oppure `CURRENT_PASSWORD_INVALID`; 409 `EMAIL_EXISTS`/`ACCOUNT_CHANGED`; 401 sessione scaduta, 403 accesso negato, 429 limite richieste (20 per utente in 15 minuti), 500 errore generico. Gli errori SQL non vengono propagati né registrati con dati delle credenziali.

Le sessioni esistenti e il token CSRF restano validi dopo il cambio. I login successivi richiedono la nuova email/password. L'email viene sostituita immediatamente: il progetto non dispone di un flusso di verifica email tramite invio di token e non ne viene introdotto uno.

`src/localizzazione/it.json` e `en.json` contengono le traduzioni tipizzate (es. `account.title`, `account.newEmail`, `language.label`, `maps.selected`). `errori-server.json` associa i messaggi del contratto di registrazione preesistente a chiavi controllate. `lingua.ts` gestisce interpolazioni, formattazione locale delle date e aggiornamento React senza ricaricamenti. `SelettoreLingua.tsx` è visibile nell'intestazione anche da anonimo; la scelta manuale predefinita IT viene salvata in `localStorage`, chiave `waveset.lingua`. Se lo storage non è disponibile, la scelta resta valida in memoria. Il documento aggiorna `lang` e titolo; dati del catalogo, filtri, URL e valori API restano indipendenti dalla lingua.

I testi applicativi della mappa e i titoli dei marker cambiano senza ricreare la mappa o alterare selezione, camera e modalità. I controlli interni forniti dall'SDK Google usano la lingua scelta al primo caricamento: per aggiornare anche questi dopo un cambio lingua occorre un refresh. Lo SDK non viene caricato nuovamente durante il cambio lingua.

### Verifica senza scritture nel DB

- `node --test test/accountSenzaDb.test.js` dalla cartella backend verifica gli endpoint HTTP reali, bcrypt, nuove credenziali al login, CSRF, ruoli, errori e concorrenza con persistenza/sessioni esclusivamente in memoria.
- I test frontend coprono i form, i messaggi già visibili al cambio lingua, la persistenza, i dizionari, l'assenza di testi statici JSX e la regressione dei marker durante il cambio lingua.
- La prova Chrome sul frontend test usa risposte account/autenticazione simulate e verifica UI desktop/mobile, cambio lingua, refresh e login con credenziali aggiornate. Non prova un cambio credenziali sul MySQL reale e non crea utenti o sessioni nel DB.

## Follow artisti e filtro eventi persistente

Nel dettaglio di un artista locale, un USER autenticato vede lo stato **Segui questo artista / Non segui questo artista** e il pulsante **Segui artista / Smetti di seguire**, con equivalenti EN. L'identità viene risolta prima di caricare il dettaglio personale. Il valore iniziale arriva dal campo `seguito` di `GET /api/artisti/:id`; dopo la mutazione riuscita lo stato si aggiorna immediatamente. Durante la richiesta il pulsante è disabilitato; doppio click non produce richieste concorrenti. Un errore conserva lo stato precedente e mostra un messaggio controllato, tradotto anche se già visibile. Al refresh lo stato viene riletto dal server. Ospiti e ADMIN non hanno il pulsante.

Si riutilizzano i contratti esistenti, senza nuovi endpoint:

| Chiamata | Contratto |
|---|---|
| `PUT /api/artisti/:id/segui` | USER, idempotente; successo 204 senza corpo, artista inesistente 404 |
| `DELETE /api/artisti/:id/segui` | USER, idempotente; successo 204 anche se il follow non esiste |
| `GET /api/artisti/:id` | JSON del dettaglio esistente con `seguito: true/false`, `Cache-Control: no-store` |

Le mutazioni richiedono la sessione; nel browser si usano cookie HttpOnly e CSRF/origine esistenti. ID non valido: 400; ospite: 401; ADMIN o CSRF/origine non validi: 403; guasto DB: 500 `{ "messaggio": "Errore interno del server" }`. Il client non invia ID utente né ruolo: il server usa l'identità della sessione. Nessuna modifica al contratto bearer. La chiave primaria `(utente_id, artista_id)` di `utente_artista` impedisce duplicati; nessuna migrazione o modifica ai seed.

`GET /api/eventi?filtro=seguiti` usa già un `EXISTS` sulla lineup e sui follow dell'utente corrente: basta che sia seguito **un qualsiasi artista della lineup**, anche secondario. Un evento compare una sola volta anche quando sono seguiti più artisti della stessa lineup. Il frontend usa la stessa risposta per lista e marker; con zero risultati mostra il messaggio dedicato e nessun marker. I link al dettaglio evento e il ritorno mantengono `?filtro=seguiti`. Da ospite il filtro non è mostrato sulla lista pubblica; su un URL diretto `?filtro=seguiti` è disabilitato e compare l'invito ad accedere.

### Test e verifica reale del follow

```bash
# Dalla cartella backend: HTTP reale con persistenza in memoria, senza DB.
node --test test/followSenzaDb.test.js

# Solo con backend Compose test in esecuzione e .env.test configurato.
node --env-file=../.env.test --test test/followPersistenza.test.js
```

Il secondo test usa la fixture **Test B già esistente**, si ferma se ha follow iniziali, prova login, follow duplicato, persistenza SQL, filtro con un artista secondario e unfollow idempotente. La canarina esistente verifica che API e connessione SQL usino lo stesso DB. Il test elimina soltanto i follow e le sessioni temporanei creati dalla prova e verifica il ripristino dei follow iniziali; non crea utenti o eventi.

In questo incremento: **247 test frontend**, **8 test HTTP follow in memoria**, **1 test HTTP/DB persistente**, lint, TypeScript e build host/Docker PASS. Chrome reale su `localhost:5174`, desktop e mobile, ha verificato login Test B, follow/unfollow via tastiera/tap, persistenza e refresh, filtro vuoto/non vuoto, Google Maps reale, sincronizzazione lista/marker, click/tap al dettaglio e ritorno col filtro, deduplica e testi IT/EN. Nessuna risposta API simulata in questa prova Chrome. Follow e sessioni preesistenti conservati; temporanei ripuliti. La prova non modifica il DB normale, schema, seed, catalogo o configurazione Google e non ripete l'avvio da clone/volume vuoto. Script e screenshot diagnostici sono fuori dal repository, in `/private/tmp/waveset-follow-reale/`.
