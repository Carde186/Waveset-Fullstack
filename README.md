# Waveset Fullstack

Piattaforma didattica di scoperta musicale elettronica: gli ospiti esplorano musica ed eventi, gli utenti registrati seguono artisti e gestiscono playlist, un ADMIN gestisce catalogo, eventi e revisioni. Apple Music e Spotify sono destinazioni esterne, non un player integrato.

> **Stato: lavori in corso. Il Fullstack NON è completo.**
> Oggi esistono backend, database e due Compose. Il frontend web ha accesso, registrazione, area, Esplora locale ed Eventi con dettaglio e Google Maps configurabile. La verifica con browser e Compose di test riguarda l'incremento precedente; Eventi e Maps sono stati verificati sull'host con API e SDK simulati. Il Compose normale resta senza frontend. Playlist web è ancora da implementare.

## Indice

1. [Cosa funziona oggi](#cosa-funziona-oggi)
2. [Da implementare](#da-implementare)
3. [Prerequisiti](#prerequisiti)
4. [Avvio dell'ambiente normale (solo ADMIN)](#avvio-dellambiente-normale-solo-admin)
5. [Ambiente di test e suite](#ambiente-di-test-e-suite)
6. [Servizi, porte e volumi](#servizi-porte-e-volumi)
7. [Variabili d'ambiente e chiavi](#variabili-dambiente-e-chiavi)
8. [Dati: locali persistenti, demo e test](#dati-locali-persistenti-demo-e-test)
9. [Account e sicurezza](#account-e-sicurezza)
10. [API del backend](#api-del-backend)
11. [Struttura del repository](#struttura-del-repository)
12. [Limiti noti](#limiti-noti)
13. [Funzionalità future e riferimenti](#funzionalità-future-e-riferimenti)

---

## Cosa funziona oggi

La tabella include verifiche precedenti, riepilogate in `RIASSUNTO-CONVERSAZIONE.md`. La verifica del **1 ottobre 2026** copre il frontend nel Compose di test, il browser reale, il 503 e i controlli elencati in [Ambiente di test e suite](#ambiente-di-test-e-suite). Lo stack normale è stato confrontato solo tramite metadati Docker, senza avvio, ricostruzione o query al suo DB.

| Componente | Stato |
|---|---|
| **Backend** Node.js + Express + MySQL (`backend/`) | Funziona: API di catalogo, ricerca locale, eventi, novità, follow, playlist, login/logout con sessioni, route riservate ad ADMIN (coda di revisione eventi, anteprime Spotify e Deezer). |
| **MySQL 8.4** | Funziona nei due ambienti, con schema e catalogo demo creati dagli script di `backend/db/init/` al primo avvio su volume vuoto. |
| **Compose normale** (`docker-compose.yml`, progetto `waveset-fullstack`) | Funziona: `mysql` → `admin-init` → `backend`. Al primo avvio nel DB c'è **un solo utente, un ADMIN**. |
| **Compose di test** (`docker-compose.test.yml`, progetto `waveset-test`) | Frontend nginx verificato insieme a backend e MySQL, con DB `waveset_test` separato. Volume esistente riutilizzato; il seed già completato non è stato rieseguito. |
| **Solo ADMIN iniziale** | L'ADMIN è creato da `backend/scripts/creaAdmin.js` con credenziali lette da `.env`. Non ci sono account USER nei seed versionati. |
| **Porte** | Normale: backend `3002`, MySQL `3307`. Test: backend `3001`, MySQL `3308`, frontend `5174`. Pubblicazione solo su `127.0.0.1`; il browser apre `http://localhost:5174`. |
| **`.env.example` e `.env.test.example`** | Presenti, senza valori segreti. |
| **`scripts/preflight.sh`** | Controllo in sola lettura di volume, container e porte prima dell'avvio. |
| **Registrazione USER** (`POST /api/auth/registrazione`) con **rate limit** (30 richieste per IP ogni 15 minuti) | Implementata e **testata sul solo ambiente di test** (vedi [Registrazione](#registrazione-di-un-nuovo-utente)). Lo stack normale in esecuzione va ricostruito per averla. |
| **Rate limit del login bearer** (`/auth/login`) | Implementato e **testato sul solo ambiente di test**: 10 fallimenti per IP+email, 50 fallimenti e 100 tentativi totali per IP ogni 15 minuti, 429 prima di bcrypt (vedi [Rate limit del login](#rate-limit-del-login-bearer)). Lo stack normale in esecuzione va ricostruito per averlo. |
| **Sessione browser** | **Verificata con Chrome reale nello stack di test:** registrazione, login, `/auth/io` dopo refresh, logout e logout-tutti, revoca della seconda sessione, cookie HttpOnly, SameSite=Strict, Path=/api, Origin del browser e CSRF del frontend. Verificati anche 401, 429 e 503 reali e pagina/API 404. |
| **Controlli del 1 ottobre** | Frontend: lint, typecheck, 96 test e build passati sull'host; build Docker frontend passata. Backend: 385 test in 42 suite, nei sette file pertinenti a configurazione web, Origin, cookie, CSRF e rate limit. La suite completa backend di 833 test non è stata rieseguita. |
| **Eventi + Maps, 2 ottobre** | Frontend: 188 test in 14 file, lint, typecheck e build passati sull'host; SDK Maps e HTTP simulati. Backend: 2 test SQL isolati senza DB. Nessun Docker, DB o browser reale avviato. |

Non è ancora verificato il **secondo avvio** dello stack normale con il volume già popolato (vedi [«Limiti noti»](#limiti-noti)).

## Da implementare

Obiettivi del progetto (non presenti nel codice). Stato per voce:

| Voce | Stato |
|---|---|
| Frontend web React responsive, identità grafica «Club» | **Parziale**: Accedi, Registrati, Area, Esplora locale ed Eventi con dettaglio sono implementati. Maps richiede configurazione Google e prova reale. Restano Playlist, revisione ADMIN e frontend nel Compose normale. |
| Registrazione autonoma di nuovi USER | **Verificata nel Compose di test** con schermata web e login successivo separato. |
| Sessione per il browser (cookie HttpOnly, CSRF, `Origin`, sessione web di 7 giorni) | **Verificata nel Compose di test.** Restano la configurazione web dello stack normale e la cancellazione del cookie revocato su 401 lato backend. |
| Scelta e documentazione della sessione per il browser | **Scelta: cookie HttpOnly + CSRF in memoria.** Il contratto bearer preesistente resta disponibile. |
| Ricerca Apple live (iTunes Search API) mediata dal backend, distinta dal catalogo locale | **Da implementare** |
| Promozione controllata di un risultato Apple nel catalogo locale | **Da implementare** |
| Sezione «In tendenza» da feed Apple | **Da implementare** (opzionale) |
| Scheduler automatico di sincronizzazione Ticketmaster (un solo esecutore, cache, backoff, protezione delle correzioni ADMIN) | **Da implementare**. Esiste un import Ticketmaster **manuale** ereditato dal backend originale (`backend/scripts/importaTicketmaster.js`, non verificato in questa sessione) |
| Google Maps JavaScript API nella pagina Eventi, con i quattro layer Standard / Scura / Satellite / Ibrida | Implementata nel frontend; SDK simulato nei test, non verificata con chiave e Google reali. Senza configurazione resta disponibile la lista. |
| Ollama locale per la revisione ADMIN dei casi ambigui Apple ↔ Ticketmaster | **Da implementare** |
| Rimozione della dipendenza dalla Spotify Web API | **Da rivedere**: nessuna chiave Spotify è richiesta per avviare, ma esiste ancora un'anteprima ADMIN opzionale che la usa |
| Test per le funzioni future (Apple live, scheduler, Ollama, Maps) | Maps e gli eventi hanno test simulati. Apple live, scheduler e Ollama restano da implementare e testare. Registrazione, sessione browser e rate limit hanno già test; il flusso browser è stato verificato sul Compose di test. |

## Prerequisiti

- **Docker Desktop** (o Docker Engine con il plugin Compose v2), in esecuzione.
- **bash** e **lsof** (per `scripts/preflight.sh`; su macOS ci sono già).
- **Node.js e npm**, solo per eseguire la suite sull'host. Testata con Node 26; requisito minimo non determinato.
- Nessuna chiave API è necessaria per avviare gli stack come sono oggi (vedi [Variabili d'ambiente e chiavi](#variabili-dambiente-e-chiavi)).

## Avvio dell'ambiente normale (solo ADMIN)

> **Il Compose normale avvia backend + database**, più il passo che crea l'ADMIN. Non avvia il frontend, disponibile nel Compose di test descritto sotto. L'avvio completo da clone e volume vuoto non è stato riprovato in questo incremento.

Da un clone pulito, nella radice del repository:

```bash
cp .env.example .env
```

Apri `.env` e compila **almeno**:

- `DB_PASSWORD` e `MYSQL_ROOT_PASSWORD`: scegli password tue e diverse tra loro;
- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: le credenziali del tuo ADMIN locale. La password deve avere **almeno 12 caratteri**, altrimenti `admin-init` termina con errore e il backend non parte.

`.env` è ignorato da Git: non versionarlo e non incollarlo in issue o chat.

Poi:

```bash
scripts/preflight.sh normale     # sola lettura: si ferma davanti a risorse sospette
docker compose up -d --build
```

Al primo avvio, con il volume nuovo, avvengono in quest'ordine:

1. `mysql` crea il DB ed esegue gli script di `backend/db/init/` (schema e catalogo demo). Il healthcheck usa il ping **via TCP**, così lo stack non risulta «healthy» mentre l'init è ancora in corso.
2. `admin-init` esegue `scripts/creaAdmin.js`: crea l'ADMIN con `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Se esiste già un ADMIN non lo modifica (comportamento previsto dal codice; il secondo avvio non è ancora stato verificato).
3. `backend` parte solo dopo che `admin-init` è terminato con successo.

Controlli rapidi:

```bash
docker compose ps -a
curl http://localhost:3002/health          # {"stato":"ok","database":"connesso"}
curl http://localhost:3002/api/generi      # elenco dei generi del catalogo demo
```

Fermare senza perdere dati:

```bash
docker compose stop        # oppure: docker compose down
```

> ⚠️ **Non usare `docker compose down -v`, `docker volume rm` o `docker volume prune` se vuoi conservare i dati**: eliminano i volumi. `docker volume prune` e `docker system prune --volumes` sono **globali** e possono eliminare anche volumi di altri progetti che non hanno container in esecuzione. Nessuno script di questo repository elimina volumi.

I nomi fissi del progetto Compose (`waveset-fullstack`, `waveset-test`) e dei volumi servono a evitare collisioni con altri progetti Docker sulla stessa macchina, per esempio un altro progetto che si trovi in una cartella chiamata `backend`.

### Primo accesso

Il Compose **normale** non avvia un'interfaccia web; il frontend di test ha accesso, registrazione e un'area essenziale, senza funzioni ADMIN. Nel normale l'ADMIN si usa tramite API, per esempio `POST /api/auth/login` con `email`, `password` e `X-Device-Id` con un UUID. Il login dell'ADMIN normale non è stato provato in questo incremento.

## Ambiente di test e suite

Il Compose di test include **frontend nginx + backend + MySQL**. L'ambiente è separato dal normale: progetto `waveset-test`, volume `waveset_test_mysql_data`, DB `waveset_test` e `.env.test`. Gli utenti `test-a`, `test-b` e `test-admin` sono fixture solo di test.

Per un primo avvio, prepara `.env.test` dal modello **solo se il file non esiste**, compilando le password localmente. La procedura completa su volume vuoto non è stata riprovata in questo incremento:

```bash
cp .env.test.example .env.test     # solo se non esiste; compila le password localmente
scripts/preflight.sh test
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test config --quiet
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --build

cd backend
npm ci
npm test
```

**Avvio effettivamente verificato su volume e seed già esistenti:** costruito solo `frontend`; il codice nel container backend coincideva con `backend/src`, quindi la sua immagine è stata riutilizzata. MySQL è stato avviato e atteso prima di backend e frontend; `seed-test`, già terminato con codice 0, non è stato rieseguito.

```bash
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test build frontend
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --wait --wait-timeout 120 mysql
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --wait --wait-timeout 120 backend frontend
```

Apri **http://localhost:5174**, l'origine esatta ammessa. `127.0.0.1:5174` è un'altra origine. nginx serve la SPA e inoltra `/api/` a `http://backend:3000`, mantenendo un'unica origine per il browser. Il frontend ha un healthcheck HTTP e dipende dall'avvio del backend; il backend non ha un healthcheck Compose, quindi è stato verificato anche con `http://localhost:3001/health`.

**Prova del 503 reale, verificata senza scrivere `.env.test`:** l'override vuoto cambia soltanto `FRONTEND_ORIGINS` del backend di test. Eseguire sempre anche il ripristino:

```bash
FRONTEND_ORIGINS_TEST='' docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --force-recreate --wait --wait-timeout 60 backend
# Ripristino senza override:
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test up -d --no-deps --no-build --force-recreate --wait --wait-timeout 60 backend
```

Chrome ha verificato login `503` e relativo messaggio; dopo il ripristino, ambiente effettivo del container corretto, `/health` positivo e login con credenziali inesistenti nuovamente `401`, senza cookie. Il login valido e l'intero flusso autenticato erano stati verificati prima dell'override.

**Esiti del 1 ottobre 2026:** registrazione `201`, login `200`, `/auth/io` dopo refresh `200`, logout e logout-tutti `204`, seconda sessione revocata `401`. Cookie HttpOnly, SameSite=Strict, Path=/api, senza Secure sul solo HTTP di test; cookie accettato e inviato dal browser, invisibile a `document.cookie`, storage vuoti e CSRF inviato/accettato sui logout. Origin mai impostato manualmente. Verificati login errato `401`, rate limit registrazione `429` con `Retry-After`, pagina frontend 404 e API `404`.

Lo script Chrome/CDP è temporaneo, fuori dal repository. Le sue attese sono state corrette per il CSS uppercase (`textContent` per i selettori) e per il consumo dei corpi fetch; queste correzioni non hanno richiesto modifiche applicative. Utenti E2E 142–145 rimossi per ID esatti, con anteprima e transazioni; sessioni 1248–1249 eliminate per ID, 1250–1252 già revocate dai logout. Stato finale verificato: utenti 1, 2, 3 invariati, **3 utenti, 0 sessioni, 0 playlist, 2 follow**. Container, immagini, tempi di avvio e contatori di riavvio dello stack normale e identità del suo volume invariati; DB normale non interrogato.

Controlli sull'host: frontend `npm run lint`, `npm run typecheck`, `npm test` (**96 test**) e `npm run build`; backend **385 test in 42 suite** nei file `origini`, `cookieSessione`, `csrf`, `configurazioneWeb`, `limiteLogin`, `limiteRichieste`, `proteggiSessioneCookie`. Questi test backend non scrivono nel DB; la suite completa precedente di 833 test non è stata rieseguita.

Comando dei test backend selezionati, da `backend/`, con le impostazioni di test usate nella verifica:

```bash
DB_HOST=127.0.0.1 DB_PORT=3308 DB_NAME=waveset_test \
node --env-file=../.env.test --test --test-concurrency=1 --test-reporter=tap \
  test/origini.test.js test/cookieSessione.test.js test/csrf.test.js \
  test/configurazioneWeb.test.js test/limiteLogin.test.js \
  test/limiteRichieste.test.js test/proteggiSessioneCookie.test.js
```

Arresto previsto del solo test, **non eseguito durante questa verifica**:

```bash
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test stop
```

`npm test` esegue `node --test` con `--env-file=../.env.test`, un file alla volta (`--test-concurrency=1`).

**Protezioni pensate perché i test non scrivano nel DB normale:**

- Il nome del DB di test è fisso (`waveset_test`) e host e porta li imposta `backend/test/preparaAmbiente.js`: dall'host il DB si vede su `127.0.0.1:3308`, mentre dentro Compose il backend lo vede come `mysql:3306`. `DB_HOST`, `DB_PORT` e `DB_NAME` **non** stanno in nessun `.env`.
- L'URL delle API è ammesso solo verso `localhost` / `127.0.0.1` sulla porta del backend di test (3001) o sulle porte delle app avviate dai test stessi (3096–3099). Non c'è più un valore predefinito verso il backend normale.
- Prima di ogni scrittura via HTTP una «canarina» inserisce un genere `__canary_<uuid>` nel DB di test e controlla che il server sotto prova lo restituisca da `GET /api/generi`; poi lo cancella per id e nome esatti. Se il server legge un altro DB, i test si fermano.

Sono stati eseguiti solo contro il DB di test. **Non lanciare `npm test` puntando al DB normale.**

Se un test fallisce, non rieseguire i seed a mano né azzerare il volume «per riprovare»: leggi prima il motivo.

## Servizi, porte e volumi

| | Normale | Test |
|---|---|---|
| File Compose | `docker-compose.yml` | `docker-compose.test.yml` |
| Progetto Compose | `waveset-fullstack` | `waveset-test` |
| Servizi | `mysql`, `admin-init`, `backend` | `mysql`, `seed-test`, `backend`, `frontend` |
| Frontend / origine browser | non previsto | `http://localhost:5174` (bind `127.0.0.1:5174`) |
| Backend (host) | `127.0.0.1:3002` | `127.0.0.1:3001` |
| MySQL (host) | `127.0.0.1:3307` | `127.0.0.1:3308` |
| Volume MySQL | `waveset_fullstack_mysql_data` | `waveset_test_mysql_data` |
| Database | `waveset` (da `DB_NAME`) | `waveset_test` (fisso) |
| Dati iniziali | schema + catalogo demo + **1 ADMIN** | schema + catalogo demo + utenti e fixture di test |
| File di variabili | `.env` | `.env.test` |

- Dentro la rete Compose il backend raggiunge il DB come `mysql:3306`, e il backend ascolta sulla porta `3000` del container.
- Gli script `backend/db/init/` vengono eseguiti **solo su un volume MySQL vuoto** (comportamento dell'immagine ufficiale `mysql`).
- Lo stato di un volume di sviluppo **non** viene trasferito da Git: chi clona parte da schema + demo + ADMIN creato con le proprie credenziali.

`scripts/preflight.sh test|normale` (sola lettura) controlla che Docker risponda, che un volume già esistente appartenga davvero al progetto atteso (nome, label Compose, container collegati, cartella di origine) e che le porte siano libere o del progetto. Si ferma con un messaggio se Docker non è raggiungibile: non scambia un errore per «volume inesistente».

## Variabili d'ambiente e chiavi

Nessun valore è riportato qui. Gli esempi sono `.env.example` e `.env.test.example`.

**Richieste per avviare l'ambiente normale (`.env`)**

| Variabile | Uso |
|---|---|
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | database applicativo |
| `MYSQL_ROOT_PASSWORD` | password root del container MySQL |
| `MYSQL_HOST_PORT`, `BACKEND_HOST_PORT` | porte sull'host (predefinite 3307 e 3002) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 12 caratteri), `ADMIN_NOME` | unico account predisposto |

**Richieste per l'ambiente di test (`.env.test`)**: `DB_USER`, `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MYSQL_HOST_PORT`, `BACKEND_HOST_PORT`. `FRONTEND_HOST_PORT` è facoltativa (default `5174`); `FRONTEND_ORIGINS_TEST` assente usa `http://localhost:<porta frontend>`, vuota disabilita il web. Il caso vuoto e il ripristino sono stati verificati con override temporaneo, senza modificare `.env.test`.

**Facoltative oggi**

| Variabile | A cosa serve oggi |
|---|---|
| `TICKETMASTER_API_KEY` | import eventi Ticketmaster **manuale** ereditato dal backend originale. Chiave gratuita dal portale sviluppatori Ticketmaster. Senza chiave il resto dell'app funziona. |
| `GOOGLE_GEOCODING_API_KEY` | fallback di geocodifica dell'import quando Ticketmaster non dà coordinate valide. Chiave **server**, separata da quella del browser, ristretta alla sola Geocoding API. |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | solo l'anteprima ADMIN Spotify (`/api/admin/spotify/anteprima`). Senza queste chiavi quella route risponde 503 e il resto funziona. **Non servono per avviare o usare il progetto.** |
| `RATE_LIMIT_REGISTRAZIONE_MAX`, `RATE_LIMIT_REGISTRAZIONE_FINESTRA_SEC` | soglie del rate limit della registrazione. **Valori normali: 30 richieste per IP ogni 900 secondi.** |
| `RATE_LIMIT_LOGIN_COPPIA_MAX`, `RATE_LIMIT_LOGIN_IP_FALLIMENTI_MAX`, `RATE_LIMIT_LOGIN_IP_TOTALE_MAX`, `RATE_LIMIT_LOGIN_FINESTRA_SEC` | soglie del rate limit del login. **Valori normali: 10 fallimenti per IP+email, 50 fallimenti per IP, 100 tentativi totali per IP, finestra 900 secondi.** |
| `FRONTEND_ORIGINS`, `COOKIE_SECURE` | configurazione della sessione browser (vedi [Sessione per il browser](#sessione-per-il-browser-in-corso)). Il **Compose di test** inoltra `FRONTEND_ORIGINS=http://localhost:5174` per default e imposta `COOKIE_SECURE=false` per il suo HTTP locale. Il **Compose normale** non le inoltra. Con HTTPS va configurato `COOKIE_SECURE=true`; HTTPS non è stato verificato. |

Sul rate limit: se le variabili sono assenti o vuote valgono i valori normali; un valore non valido (non un intero ≥ 1) **ferma l'avvio del backend**. `docker-compose.yml` inoltra tutte e sei al backend, con quei valori normali come predefiniti (commentate in `.env.example`). Il Compose di test le imposta molto più alte (registrazione 1000; login 1000 / 1000 / 10000; finestra 900 s, facoltative in `.env.test`) perché la suite registra e accede decine di volte dallo stesso IP; i limitatori veri si provano con soglie basse iniettate nei test.

**Configurazione browser della mappa e funzioni future**

| Chiave / configurazione | Per che cosa |
|---|---|
| `VITE_GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_MAP_ID` | Mappa della pagina Eventi; esempi vuoti in `frontend/.env.example` e `.env.test.example`. Valori locali in `frontend/.env.local` per Vite o `.env.test` per la build Compose. Chiave browser visibile nel bundle: proteggere con referrer HTTP ammessi e restrizione Maps JavaScript API. Occorre un Map ID JavaScript per i marker avanzati. Servizio e fatturazione vanno attivati nel progetto Google Cloud. [Istruzioni frontend](frontend/README.md#eventi-e-google-maps). |
| Ticketmaster (già sopra) | Sincronizzazione automatica degli eventi. |
| URL e nome del modello **Ollama** | Revisione AI locale. Ollama non usa chiavi cloud; non sono previsti fallback cloud. |

Le API pubbliche di iTunes Search non richiedono chiavi.

## Dati: locali persistenti, demo e test

Non tutti i dati hanno lo stesso valore. **Nulla di quanto segue è un catalogo o un calendario di eventi reali e aggiornati.**

| Dati | Dove | Che cosa sono |
|---|---|---|
| **Catalogo demo** | `backend/db/init/02_seed.sql` | 4 generi e 4 artisti **inventati** (Nova Circuit, Sunset Grid, Lucent Wave, Break Signal) con album e brani inventati. Le immagini sono **segnaposto picsum.photos**, quindi **non sono foto di artisti né artwork reali**: il frontend dovrà sostituirle. |
| **Eventi demo** | `backend/db/init/06_eventi_seed.sql` | 4 eventi **inventati** (locali, titoli e date del 2027 scelti a mano). Non vengono aggiornati da nessuna fonte. |
| **Utenti e fixture di test** | `backend/db/test/` | Solo nel DB di test: `test-a`, `test-b`, `test-admin` con password di prova, i follow di `test-a`, e fixture minime per Carl Cox e Charlotte de Witte (nome, un album e alcuni brani) usate dai test dei link esterni. Non sono un catalogo. |
| **Link esterni verificati** | `backend/src/spotify/`, `backend/src/itunes/` | Mappature statiche di album/brani reali con link Spotify e Apple Music verificati. Si applicano solo se nel DB esiste una voce con lo stesso nome artista e titolo. |
| **Script di importazione del catalogo reale** | `backend/scripts/importaCatalogoRealeLotto*.js` | Ereditati dal backend originale. **Non sono eseguiti da nessun Compose** e non sono stati provati in questa sessione. |

Il database persistente dell'ambiente normale è ciò che l'app scrive nel volume `waveset_fullstack_mysql_data`. I risultati di future ricerche Apple live saranno invece dati **esterni** e temporanei, distinti dal catalogo locale.

## Account e sicurezza

- **Ruoli:** `USER` e `ADMIN`. Il ruolo è deciso dal server; oggi l'unico modo di avere un ADMIN è lo script `creaAdmin.js`.
- **Nessun USER predefinito:** i seed versionati non creano utenti. L'ADMIN si crea con **credenziali locali** (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), non con una password versionata.
- **Password:** hash **bcrypt** con costo 12; il backend non salva password in chiaro. Regole di registrazione: almeno 12 caratteri e al massimo 72 byte UTF-8 (limite di bcrypt; oltre si rifiuta, non si tronca).
- **Ruolo:** alla registrazione il ruolo è sempre `USER`, scritto dal server. Il client non può proporre `ruolo`, `role` né altri campi: qualsiasi campo diverso da `nome`, `email` e `password` dà 400.
- **Sessioni:** il contratto bearer con `X-Device-Id` resta disponibile (30 giorni). Il browser usa cookie HttpOnly di 7 giorni e CSRF conservato solo in memoria; nessun salvataggio in localStorage/sessionStorage. Nel DB è salvato solo lo SHA-256 del token di sessione.
- **Route ADMIN** (`/api/admin/*`): richiedono sessione valida **e** ruolo `ADMIN`.
- **Isolamento dei dati:** playlist e follow sono per utente; le prove di isolamento sono nella suite di test.
- **Porte solo in locale:** MySQL e backend sono pubblicati su `127.0.0.1`, non sulla rete.
- **`admin-init` crea un solo ADMIN** e non ne promuove altri: se `ADMIN_EMAIL` esiste già come USER, fallisce.

## API del backend

Panoramica **non esaustiva** delle famiglie di route (dettaglio in `backend/src/routes/` e nei test). Il backend è raggiungibile su `http://localhost:3002` (normale) o `http://localhost:3001` (test).

| Area | Route (sotto `/api`, salvo `/health`) | Accesso |
|---|---|---|
| Stato | `GET /health` (fuori da `/api`) | pubblico |
| Catalogo | `/generi`, `/artisti`, `/brani/:id`, `/album/:id`, `/ricerca?q=` | pubblico |
| Link esterni | `/album/:id/link-spotify`, `/brani/:id/link-apple`, `/album/:id/copertina-itunes` | pubblico |
| Eventi e novità | `GET /eventi?filtro=tutti`, `GET /eventi?filtro=seguiti`, `GET /eventi/:id`, `/novita` | Eventi tutti e dettaglio pubblici; seguiti richiede una sessione valida (401), filtro non valido 400, ID assente/non pubblicato 404. |
| Account | `/auth/login` (bearer, app Android), `/auth/web/login` (browser, richiede la sessione web configurata), `/auth/io`, `/auth/logout`, `/auth/logout-tutti` (bearer o cookie) | login pubblici; gli altri richiedono una sessione |
| Follow | `/artisti/:id/segui` | autenticato |
| Playlist | `/playlist` | autenticato, per utente |
| Deezer | `/deezer/scopri` | autenticato |
| ADMIN | `/admin/eventi` (coda di revisione), `/admin/spotify/anteprima`, `/admin/deezer/anteprima` | ADMIN |

Non esistono ancora le route di ricerca Apple live, sincronizzazione Ticketmaster automatica né revisione AI. Registrazione e sessione browser sono verificate nello stack di test; il login web usa `/api/auth/web/login`, mentre il contratto bearer resta separato.

### Registrazione di un nuovo utente

`POST /api/auth/registrazione`, pubblico, corpo JSON con **esattamente** `nome`, `email` e `password`. Non apre nessuna sessione: il frontend passa alla schermata di accesso e usa `/api/auth/web/login`.

| Risposta | Quando |
|---|---|
| `201 { "utente": { id, nome, email, ruolo: "USER" } }` | registrazione riuscita |
| `400 { "messaggio": "Dati non validi", "campi": { … } }` | validazione fallita (i messaggi non riportano i valori inviati) |
| `400 { "messaggio": "Richiesta non valida" }` | JSON malformato |
| `409 { "messaggio": "Email già registrata" }` | email già presente |

Regole:

- **Campi ammessi:** solo `nome`, `email`, `password`. Qualsiasi altro campo, compresi `id`, `ruolo` e `role`, dà **400**: il ruolo è deciso dal server (`USER`) e il client non può nemmeno proporlo.
- **`nome`:** testo, spazi ai bordi tolti, da 1 a 200 caratteri, senza caratteri di controllo.
- **`email`:** testo, spazi tolti e minuscolo, massimo 255 caratteri, forma `x@y.z`. Il dominio **`waveset.test` e i suoi sottodomini sono riservati ai test** e non si possono registrare.
- **`password`:** da 12 caratteri a 72 byte UTF-8; non viene modificata (nessun trim). Sono rifiutate password vuote o solo di spazi e con il carattere NUL.
- **Salvataggio:** hash bcrypt (costo 12) e `ruolo` fisso a `USER`. L'unicità dell'email è garantita dal vincolo `UNIQUE` del database, quindi due registrazioni parallele con la stessa email non passano entrambe.

**Rischi e limiti noti (non risolti):**

- **Enumerazione delle email.** Il `409` rivela che un'email è già registrata. L'hash bcrypt si calcola prima dell'`INSERT`, ma questo **non rende i tempi di risposta indistinguibili e non elimina l'enumerazione**. Il login, invece, risponde in modo uniforme a email inesistente e password errata.
- **Rate limit della registrazione (limiti dichiarati).** Vedi la sezione seguente: limitatore in memoria, `trust proxy` disattivato.
- **Nessuna verifica dell'email:** un indirizzo non viene controllato, e non c'è recupero password.
- **DB normale.** Una registrazione crea un account reale nel volume dell'ambiente normale. I test la provano **solo** su `waveset_test`.
- **Log:** in caso di errore del database il log riporta solo il codice dell'errore, non l'SQL (che conterrebbe email e hash).

#### Rate limit della registrazione

Ogni richiesta `POST /api/auth/registrazione` viene contata **per IP**, **riuscita o no** (anche i 400), **prima** di `express.json()` e di bcrypt: una richiesta bloccata non paga né il parsing del corpo, né la validazione, né l'hash.

- **Valori normali:** **30 richieste per IP ogni 15 minuti** (900 s), finestra fissa. Modificabili con `RATE_LIMIT_REGISTRAZIONE_MAX` e `RATE_LIMIT_REGISTRAZIONE_FINESTRA_SEC` (vedi [Variabili d'ambiente](#variabili-dambiente-e-chiavi)).
- **Superata la soglia:** `429 { "messaggio": "Troppe richieste, riprova più tardi" }` con l'intestazione `Retry-After` (secondi fino al reset). Le richieste bloccate non vengono contate e non allungano la finestra.
- **Chiave:** l'indirizzo del socket. IPv4 mappato in IPv6 vale come IPv4; un IPv6 conta per il suo prefisso `/64`.
- **`trust proxy` disattivato:** `X-Forwarded-For` viene ignorato, quindi un client non può falsificare l'IP per aggirare il limite. Conseguenza: dietro un reverse proxy tutti i client sembrerebbero lo stesso IP; l'uso dietro proxy richiede una configurazione esplicita che **non è ancora stata aggiunta**.
- **Memoria:** una voce per chiave, ripulita alla scadenza (a ogni accesso e con un timer periodico). Il tetto è di **10.000 chiavi**: al raggiungimento si eliminano prima solo le voci scadute e **mai** quelle ancora valide. Se la capacità resta piena di voci valide, il comportamento è **conservativo**: la richiesta di una chiave *nuova* è rifiutata con `429` e `Retry-After` fino alla scadenza della voce più vecchia; le chiavi già presenti continuano a essere contate. Conseguenza dichiarata: un attaccante con moltissimi indirizzi potrebbe temporaneamente impedire la registrazione a IP nuovi.
- **Limiti noti:** i contatori sono in memoria (si azzerano al riavvio e non sono condivisi tra più repliche); la finestra fissa permette fino al doppio delle richieste a cavallo del reset; dietro NAT (una scuola, una rete mobile) molti utenti condividono lo stesso IP e la stessa quota.

### Rate limit del login bearer

`POST /api/auth/login` (contratto bearer con `X-Device-Id`, usato dall'app Android) ha **tre contatori per IP**, tutti in una finestra di 15 minuti (900 s) e tutti controllati **prima** della query e di bcrypt:

| Contatore | Soglia normale | Cosa conta |
|---|---|---|
| IP + email | **10** | fallimenti (password sbagliata o email inesistente) |
| IP | **50** | fallimenti |
| IP (limite ampio) | **100** | tentativi **totali**, riusciti o no |

- **Contratto invariato:** 200, 400 (`email, password e X-Device-Id obbligatori`), 401 (`Email o password errati`) e il ruolo di `X-Device-Id` sono quelli di prima. Si aggiunge solo il `429 { "messaggio": "Troppe richieste, riprova più tardi" }` con `Retry-After`. Il 400 ora copre anche `email` o `password` che non sono stringhe (prima davano un 401 o, per la password, un 500).
- **Si conta prima e si rilascia dopo:** ogni tentativo viene contato prima di conoscere l'esito, così richieste parallele non superano il limite mentre bcrypt calcola. Un login **riuscito** azzera il contatore della coppia e rilascia un fallimento dell'IP, ma **resta** nel conteggio dei tentativi totali. Un errore del server (per esempio il database) rilascia tutto, perché non è un tentativo del client.
- **Nessun blocco permanente:** ogni contatore scade con la sua finestra (al massimo 15 minuti). Durante il blocco anche la password **giusta** riceve 429. Un attaccante da un altro IP non può bloccare la vittima, perché la coppia include l'IP.
- **Email inesistenti:** contano come quelle esistenti e le risposte 401 e 429 sono identiche: il blocco non rivela quali email esistono.
- **Email nella chiave:** solo spazi tolti e minuscolo, **senza togliere gli accenti**. Una variante con accenti dà un'altra coppia, ma resta il tetto per IP.
- **Capacità:** tetto di 10.000 chiavi per contatore. Si eliminano prima solo le voci scadute e **mai** quelle valide. Se la capacità resta piena, una chiave *nuova* riceve 429 (comportamento conservativo, come per la registrazione): un attaccante con moltissimi IP o email potrebbe temporaneamente impedire il login a chi non è già presente.
- **Limiti noti:** contatori in memoria (si azzerano al riavvio, non condivisi tra repliche); finestra fissa; `trust proxy` disattivato (dietro un reverse proxy tutti i client sembrerebbero lo stesso IP); dietro NAT (una scuola, una rete mobile) molti utenti condividono le quote per IP.
- **App Android:** letto il codice del client (non modificato): un 429 lancia un `ErroreRichiesta` e la schermata di accesso mostra il messaggio generico «Impossibile accedere, riprova più tardi», senza chiudere la sessione né ritentare. Non c'è una gestione dedicata del 429 né di `Retry-After`.
- **Solo nei test:** l'IP simulato entra nell'app dei test come parametro di codice (`creaApp({ ricavaIp })`), mai da un'intestazione HTTP o dall'ambiente in produzione.

### Sessione per il browser (in corso)

Descrive il contratto backend, verificato anche con il frontend nginx e Chrome nel Compose di test. Il cookie è `waveset_sid=<device_id>.<token>`; nel DB c'è solo lo SHA-256 del token e la riga sta nella stessa tabella `sessioni`.

**Collegato oggi**

- **Configurazione.** `FRONTEND_ORIGINS` (origini **esatte**: niente `*`, `null`, percorsi, corrispondenze parziali; `http` solo su `localhost`, `127.0.0.1`, `[::1]`) e `COOKIE_SECURE`. Senza una `FRONTEND_ORIGINS` valida la sessione web è **disabilitata**: il cookie non autentica nessuno, nessun controllo CSRF, e il login bearer non cambia. Un valore non valido non ferma il backend: stampa un avviso e disabilita solo il web. Con `NODE_ENV=production` serve `COOKIE_SECURE=true`, altrimenti il web resta disabilitato.
- **Trasporto cookie (`trovaSessione`).** Se la richiesta ha l'intestazione `Authorization`, anche vuota, non Bearer o non valida, conta **solo il bearer** e non c'è mai un ripiego sul cookie. Senza `Authorization`, con la sessione web abilitata, un cookie valido viene controllato come il bearer: `device_id`, hash del token (confronto a tempo costante) e scadenza. Un cookie assente, duplicato o malformato non autentica.
- **CSRF e Origin (middleware su `/api`).** Per i metodi diversi da GET, HEAD e OPTIONS con cookie di sessione e senza `Authorization` servono `Origin` fra quelle ammesse **e** `X-CSRF-Token` uguale al token CSRF di quella sessione (HMAC-SHA256 con il token di sessione come chiave), altrimenti **403** con lo stesso corpo per ogni causa (`{ "messaggio": "Richiesta non consentita" }`). Vale anche per le route pubbliche, per quelle con autenticazione facoltativa e per gli URL inesistenti: una mutazione con un cookie che non supera il controllo non prosegue **mai** come utente anonimo. Un cookie duplicato o malformato su una mutazione dà 403.
- **`POST /api/auth/web/login`** (solo con la sessione web configurata; altrimenti `503 { "messaggio": "Sessione browser non disponibile" }` senza sessione né cookie). Corpo `{ email, password }`; l'intestazione `X-Device-Id` non serve e viene ignorata. Ordine dei controlli, dal più economico:
  1. `Origin` presente e **ammesso**, prima di corpo, DB, bcrypt e limiti: altrimenti 403 (`Richiesta non consentita`), senza consumare quote;
  2. `email` e `password` stringhe non vuote: altrimenti 400 (`email e password obbligatori`);
  3. **limitatore condiviso con il login bearer** (stessi tre contatori per IP: 10 fallimenti per IP+email, 50 per IP, 100 tentativi totali): 429 con `Retry-After`. Passare da un endpoint all'altro non raddoppia le quote, e un successo su uno azzera la coppia anche per l'altro;
  4. credenziali: 401 con lo stesso corpo del bearer (`Email o password errati`, anche per email inesistenti).
  Dopo il successo: `device_id` e token **generati dal server** (mai dal client), sessione di **7 giorni** nella tabella `sessioni`, risposta `200 { "utente": {…}, "csrf": "…" }` con `Cache-Control: no-store`. **Il token di sessione e il suo hash non compaiono mai nel corpo**: sono solo nel cookie `waveset_sid` (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Max-Age=604800`, nessun `Domain`, `Secure` se `COOKIE_SECURE=true` o se la richiesta è HTTPS). Il token `csrf` va rinviato nell'intestazione `X-CSRF-Token` delle richieste non sicure, insieme all'`Origin` del browser.
- **Cookie vecchio e revoca.** `web/login` è l'**unica** eccezione al controllo CSRF (confronto esatto su `POST` e su `/api/auth/web/login`; ogni variante del percorso resta protetta): un cookie vecchio, scaduto o revocato non impedisce un nuovo login. Se la richiesta porta un cookie di sessione valido nel formato, la **sola** riga che identifica (`device_id` **e** hash del token, quindi serve possedere il token) viene cancellata **dopo** il successo del nuovo login: un login fallito, bloccato o con `Origin` errato non tocca la sessione precedente, e un guasto nella revoca non fa fallire il login. Un cookie assente, duplicato o malformato non revoca nulla. Le altre sessioni dell'utente, **Android comprese, non vengono revocate**. Limite: la tabella non ha una colonna per il canale, quindi chi presentasse come cookie il token di una sessione bearer ne causerebbe la revoca (serve comunque possedere quel token).
- **`GET /api/auth/io`.** Con il **cookie** (sessione web configurata) risponde `200 { "utente": { id, nome, email, ruolo }, "csrf": "…" }` con `Cache-Control: no-store`: il browser recupera il token CSRF dopo un ricarico (lo riceve anche dal login web) e la forma è la stessa del login web. Il `csrf` è derivato dal token che il client ha presentato: **non si restituiscono mai il token di sessione, il suo hash, il `device_id` né altro**. Con il **bearer** la risposta è **quella di sempre, piatta** (`{ id, nome, email, ruolo }`, senza `csrf`, senza `Cache-Control` aggiunto). Senza sessione valida (assente, scaduta, malformata, duplicata) 401 come per il bearer, senza `csrf`.
- **`POST /api/auth/logout`.** Chiude **solo** la sessione con cui è arrivata la richiesta (la riga trovata da `device_id` e token): le altre sessioni dell'utente, web o Android, restano. Con il **cookie** servono `Origin` ammesso e `X-CSRF-Token` valido (nessuna eccezione per i logout) e la risposta è `204` **più** un `Set-Cookie` che cancella `waveset_sid` (valore vuoto, `Max-Age=0`, `Expires` nel 1970) con gli **stessi attributi** usati per crearlo: `Path=/api`, `HttpOnly`, `SameSite=Strict`, nessun `Domain`, `Secure` con la stessa regola del login web (`COOKIE_SECURE=true` o HTTPS). Con il **bearer**: `204` senza corpo e **senza** `Set-Cookie`, come oggi.
- **`POST /api/auth/logout-tutti`.** Chiude **tutte** le sessioni dell'utente, **web e Android insieme** (è la semantica già esistente dell'endpoint: «esci da tutti i dispositivi»), e non tocca gli altri utenti. Dal cookie vale la stessa protezione (Origin + CSRF) e la stessa cancellazione del cookie; dal bearer, `204` senza `Set-Cookie`.
- **Nessun effetto collaterale sui rifiuti.** Se `Origin` o CSRF mancano o sono errati, la risposta è `403` con il corpo generico, **senza** `Set-Cookie` e senza chiudere nessuna sessione. Un cookie scaduto o assente dà 401 (senza `Set-Cookie`). Con `Authorization` presente conta solo il bearer, anche se non valido: **mai** un ripiego sul cookie, e un logout via bearer non cancella né tocca il cookie.
- **Bearer Android invariato:** `/auth/login`, `X-Device-Id`, il token in `Authorization` e la durata di 30 giorni non cambiano; le richieste con `Authorization` non passano dal controllo CSRF.
- **Ambiguità del «canale».** La tabella `sessioni` non ha una colonna per il canale (web o bearer), e non serve per `/auth/io` né per i logout: il trasporto lo decide la richiesta per come si presenta, e chi presenta un token ne ha già il potere. L'unica conseguenza (revoca al login web) è descritta sopra.
- **Nessun CORS:** il progetto prevede frontend e API sulla stessa origine (in sviluppo tramite il proxy di Vite). Su `localhost` tutte le porte sono la stessa *site*, quindi `SameSite=Strict` non separa il frontend da altre app locali: a farlo sono l'allowlist dell'`Origin` e il token CSRF.

**Non collegato ancora**

- L'inoltro di `FRONTEND_ORIGINS` e `COOKIE_SECURE` e il servizio frontend nel **Compose normale**. Nel Compose di test sono già presenti e verificati.
- Un cookie di una sessione revocata altrove (per esempio da un `logout-tutti` fatto dall'app Android) resta nel browser: un 401 **non** lo cancella ancora (lo fanno solo i logout riusciti), e su una mutazione darebbe 403. Va gestito dal frontend (ripulire la sessione locale su 401) o con una cancellazione del cookie sul 401, non ancora fatta.

### Integrazione Deezer (ereditata): che cosa fa il codice

Descrizione basata sulla lettura di `backend/src/servizi/deezer.js` e delle due route; non ho eseguito queste chiamate in questa sessione (i test le provano con il servizio simulato).

- **Credenziali:** il servizio chiama l'API pubblica `https://api.deezer.com` **senza chiavi né token**: il codice non invia nessuna credenziale e `.env.example` non prevede variabili Deezer. Un commento nel codice afferma che l'assenza di chiavi fu verificata con una sonda reale; non l'ho riprodotto.
- **Route:** sono due demo a **contenuto fisso**, non ricerca né catalogo. Non accettano id dal client e leggono sempre lo stesso artista (id Deezer 3951, indicato nel codice come Carl Cox) e lo stesso album (id 905333022):
  - `GET /api/deezer/scopri`: per utenti autenticati; restituisce nome e link Deezer dell'artista, l'album e 3 brani (id, titolo, durata, link), **senza campi immagine**;
  - `GET /api/admin/deezer/anteprima`: per ADMIN; stessa demo con fino a 5 brani.
- **Rete:** entrambe dipendono dalla raggiungibilità di `api.deezer.com`. Non ho verificato eventuali cache o timeout, perché non ho letto `backend/src/deezer/anteprima.js`.

## Struttura del repository

```
.
├── docker-compose.yml          # ambiente normale (waveset-fullstack)
├── docker-compose.test.yml     # ambiente di test (waveset-test)
├── .env.example                # modello di .env (senza valori)
├── .env.test.example           # modello di .env.test (senza valori)
├── scripts/
│   └── preflight.sh            # controlli in sola lettura prima dell'avvio
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── src/                    # app Express, route, servizi
│   ├── scripts/                # creaAdmin.js e script ereditati (import, correzioni)
│   ├── db/init/                # schema + catalogo demo (solo su volume vuoto)
│   ├── db/test/                # utenti e fixture SOLO per il DB di test
│   └── test/                   # suite (833 test) e guardie dell'ambiente
└── CLAUDE.md                   # linee guida di progetto
```

`frontend/` contiene il primo incremento del frontend (Vite + React + TypeScript, CSS Modules). Istruzioni, scelte e contratti API usati sono in [frontend/README.md](frontend/README.md).

## Limiti noti

Cose **non verificate** o con difetti noti:

- **Secondo avvio non verificato.** Non è ancora stato provato ripetere `docker compose up` sullo stack normale con il volume già popolato. Restano da confermare che `db/init` non venga rieseguito, che `admin-init` riconosca l'ADMIN esistente senza modificarlo (id, hash e conteggi invariati) e che backend e `/health` restino funzionanti. Il codice di `creaAdmin.js` è pensato per questo, ma non l'ho eseguito due volte.
- **Volume anonimo del servizio `seed-test`.** L'immagine `mysql:8.4` dichiara `VOLUME /var/lib/mysql`, quindi ogni creazione del container `seed-test` genera un **volume anonimo** inutilizzato e senza label. Non danneggia gli altri volumi ma si accumula. Correzione proposta e **non ancora applicata**: dichiarare `/var/lib/mysql` come `tmpfs` per quel servizio. Si può rimuovere a mano dopo aver controllato con `docker volume ls` che non sia usato.
- **Guardia SQL del seed di test:** verificata su un container MySQL 8.4 temporaneo (fallisce prima di scrivere se il DB non è `waveset_test` o se non c'è un DB selezionato). Non è coperta dalla suite automatica.
- **Login dell'ADMIN via API non provato** nell'ambiente normale; `npm test` non è mai eseguito sul DB normale.
- **`/health` espone il messaggio d'errore del database. Non corretto.** Quando il database non è raggiungibile, `GET /health` risponde 503 e include nel corpo il testo dell'errore del driver (`backend/src/routes/salute.js`). È un dettaglio interno che non dovrebbe essere esposto: è un limite noto e **ancora da sistemare**, non risolto.
- **Import Ticketmaster manuale** e script di importazione del catalogo reale: ereditati, non provati in questa sessione e non collegati a nessuno scheduler.
- **Stack normale non ricostruito:** l'immagine del backend normale in esecuzione è quella precedente alla registrazione: `POST /api/auth/registrazione` esiste solo nel backend di test finché non si riesegue `docker compose up -d --build` sullo stack normale (operazione non ancora fatta né verificata).
- **Rate limit in memoria (registrazione e login) e enumerazione delle email via `409`:** vedi [Registrazione](#registrazione-di-un-nuovo-utente) e [Rate limit del login](#rate-limit-del-login-bearer). I contatori si azzerano al riavvio e non sono condivisi tra repliche; `trust proxy` è disattivato, quindi dietro un reverse proxy serve una configurazione esplicita non ancora fatta prima di esporre il backend in rete.
- **Sessione browser verificata nel solo Compose di test**, oltre alla precedente prova locale. Un cookie revocato altrove non viene cancellato dal backend su 401 e può causare 403 alla registrazione. Il normale non è stato ricostruito o modificato.
- **Non verificato in questo incremento:** avvio completo da clone/volume vuoto, HTTPS, suite backend completa e arresto dello stack di test. Lo script E2E resta fuori dal repository; le verifiche locali precedenti su Vite `localhost:5173` non sono state ripetute.
- **Preflight:** `lsof` può non vedere socket di altri utenti; su un Mac con un solo utente è sufficiente.
- **Versione di Node per la suite:** testata solo con Node 26. Il requisito minimo non è stato determinato e non va dedotto da questa prova (vedi [Prerequisiti](#prerequisiti)).
- **Immagini demo:** il catalogo demo usa segnaposto picsum.photos, che il progetto vieta per il frontend definitivo.

## Funzionalità future e riferimenti

Funzionalità previste (vedi [Da implementare](#da-implementare)): ricerca Apple live e promozione controllata nel catalogo, tendenze Apple, scheduler Ticketmaster con un solo esecutore, revisione ADMIN assistita da Ollama locale. Google Maps con quattro layer è implementata nel frontend e attende prova reale con configurazione Google.

Riferimenti da consultare. **Tutti gli indirizzi qui sotto sono da verificare:** li ho scritti a memoria, non li ho aperti né confrontati con le fonti ufficiali in questa sessione, quindi non vanno considerati fonti ufficiali confermate finché non li controlli tu (e le condizioni d'uso e i limiti di ogni servizio vanno letti alla fonte prima di usarlo).

| Argomento | Indirizzo | Stato |
|---|---|---|
| Docker Compose | https://docs.docker.com/compose/ | da verificare |
| Immagine MySQL | https://hub.docker.com/_/mysql | da verificare |
| iTunes Search API | https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/ | da verificare |
| Ticketmaster Discovery API | https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/ | da verificare |
| Google Maps JavaScript API | https://developers.google.com/maps/documentation/javascript | da verificare |
| Ollama | https://ollama.com/ | da verificare |
| Node.js: `--env-file` e test runner | https://nodejs.org/api/test.html | da verificare |
| API pubblica Deezer (usata dal codice ereditato) | https://developers.deezer.com/api | da verificare |
