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
- Testi solo in italiano; il frontend è presente nel solo Compose di test. Esplora locale, Eventi e dettagli sono implementati. La mappa richiede configurazione Google; ricerca Apple live, Playlist, ADMIN e AI web restano da implementare.
- I test frontend usano un backend simulato. In questo incremento sono passati lint, typecheck, **96 test** e build sull'host, più la build Docker e la prova reale descritta sopra. Sono passati anche **385 test backend pertinenti**, senza scritture nel DB; la suite backend completa non è stata rieseguita.
- Lo script Chrome/CDP è temporaneo e non incluso nel repository. Le sue asserzioni usano `textContent` per evitare l'effetto del CSS uppercase e consumano i corpi fetch diagnostici senza stamparli; nessuna correzione applicativa è stata necessaria.
- Avvio da clone/volume vuoto, HTTPS e arresto dello stack non verificati in questo incremento. Dietro nginx i rate limit condividono l'IP del proxy perché `trust proxy` resta disattivato.
