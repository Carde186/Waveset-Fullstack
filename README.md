# Waveset Fullstack

Piattaforma didattica di scoperta musicale elettronica: gli ospiti esplorano musica ed eventi, gli utenti registrati seguono artisti e gestiscono playlist, un ADMIN gestisce catalogo, eventi e revisioni. Apple Music e Spotify sono destinazioni esterne, non un player integrato.

> **Stato: lavori in corso. Il Fullstack NON è completo.**
> Oggi esistono il **backend** (Node.js + Express), il **database** (MySQL) e i **due Compose** (normale e di test). **Il frontend web non esiste**: non c'è ancora nessuna interfaccia da aprire nel browser. Le funzioni indicate in [«Da implementare»](#da-implementare) sono obiettivi, non codice presente.

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

Verificato in questa sessione su Docker Desktop (macOS), salvo dove indicato in [«Limiti noti»](#limiti-noti).

| Componente | Stato |
|---|---|
| **Backend** Node.js + Express + MySQL (`backend/`) | Funziona: API di catalogo, ricerca locale, eventi, novità, follow, playlist, login/logout con sessioni, route riservate ad ADMIN (coda di revisione eventi, anteprime Spotify e Deezer). |
| **MySQL 8.4** | Funziona nei due ambienti, con schema e catalogo demo creati dagli script di `backend/db/init/` al primo avvio su volume vuoto. |
| **Compose normale** (`docker-compose.yml`, progetto `waveset-fullstack`) | Funziona: `mysql` → `admin-init` → `backend`. Al primo avvio nel DB c'è **un solo utente, un ADMIN**. |
| **Compose di test** (`docker-compose.test.yml`, progetto `waveset-test`) | Funziona: `mysql` → `seed-test` → `backend`, con DB `waveset_test` separato dal normale. |
| **Solo ADMIN iniziale** | L'ADMIN è creato da `backend/scripts/creaAdmin.js` con credenziali lette da `.env`. Non ci sono account USER nei seed versionati. |
| **Porte** | Normale: backend `3002`, MySQL `3307`. Test: backend `3001`, MySQL `3308`. Solo su `127.0.0.1`. |
| **`.env.example` e `.env.test.example`** | Presenti, senza valori segreti. |
| **`scripts/preflight.sh`** | Controllo in sola lettura di volume, container e porte prima dell'avvio. |
| **Suite di test** | **190 test in 59 suite, tutti passati** contro il DB di test (`npm test` in `backend/`). |

Non è ancora verificato il **secondo avvio** dello stack normale con il volume già popolato (vedi [«Limiti noti»](#limiti-noti)).

## Da implementare

Obiettivi del progetto (non presenti nel codice). Stato per voce:

| Voce | Stato |
|---|---|
| Frontend web React responsive, identità grafica «Club» | **Da implementare** (la cartella `frontend/` non esiste) |
| Registrazione autonoma di nuovi USER | **Da implementare** (oggi esiste solo il login; nessun USER si crea da API) |
| Scelta e documentazione della sessione per il browser (cookie HttpOnly + CSRF oppure bearer token) | **Da decidere**: il backend ereditato usa un bearer token con `X-Device-Id` |
| Ricerca Apple live (iTunes Search API) mediata dal backend, distinta dal catalogo locale | **Da implementare** |
| Promozione controllata di un risultato Apple nel catalogo locale | **Da implementare** |
| Sezione «In tendenza» da feed Apple | **Da implementare** (opzionale) |
| Scheduler automatico di sincronizzazione Ticketmaster (un solo esecutore, cache, backoff, protezione delle correzioni ADMIN) | **Da implementare**. Esiste un import Ticketmaster **manuale** ereditato dal backend originale (`backend/scripts/importaTicketmaster.js`, non verificato in questa sessione) |
| Google Maps JavaScript API nella pagina Eventi, con i quattro layer Standard / Scura / Satellite / Ibrida | **Da implementare** |
| Ollama locale per la revisione ADMIN dei casi ambigui Apple ↔ Ticketmaster | **Da implementare** |
| Rimozione della dipendenza dalla Spotify Web API | **Da rivedere**: nessuna chiave Spotify è richiesta per avviare, ma esiste ancora un'anteprima ADMIN opzionale che la usa |
| Test per le funzioni sopra (registrazione, Apple live, scheduler, Ollama, Maps) | **Da scrivere** insieme alle funzioni |

## Prerequisiti

- **Docker Desktop** (o Docker Engine con il plugin Compose v2), in esecuzione.
- **bash** e **lsof** (per `scripts/preflight.sh`; su macOS ci sono già).
- **Node.js e npm**, solo per eseguire la suite sull'host. Testata con Node 26; requisito minimo non determinato.
- Nessuna chiave API è necessaria per avviare gli stack come sono oggi (vedi [Variabili d'ambiente e chiavi](#variabili-dambiente-e-chiavi)).

## Avvio dell'ambiente normale (solo ADMIN)

> **Cosa copre l'avvio da clone, oggi:** **backend + database** (MySQL, più il passo che crea l'ADMIN). **Non avvia nessun frontend**, perché il frontend Fullstack non esiste ancora: dopo l'avvio non c'è nulla da aprire nel browser, solo API.

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

Ribadisco: oggi **non esiste un'interfaccia web**, né un frontend Fullstack da avviare. L'ADMIN si usa solo tramite API, per esempio per il login (`POST /api/auth/login` con `email`, `password` e l'header `X-Device-Id` con un UUID). Il login dell'ADMIN via API non è ancora stato provato in questa sessione.

## Ambiente di test e suite

Anche qui l'avvio copre **backend + database**, non un frontend (che non esiste). L'ambiente di test è **separato** da quello normale: progetto, volume, DB, porte e file `.env` diversi. Gli utenti `test-a`, `test-b` e `test-admin` esistono **solo lì**, creati da `backend/db/test/`, e non compaiono mai nel DB normale.

```bash
cp .env.test.example .env.test     # compila DB_PASSWORD e MYSQL_ROOT_PASSWORD
scripts/preflight.sh test
docker compose --env-file .env.test -f docker-compose.test.yml up -d --build

cd backend
npm ci
npm test
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
| Servizi | `mysql`, `admin-init`, `backend` | `mysql`, `seed-test`, `backend` |
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

**Richieste per l'ambiente di test (`.env.test`)**: `DB_USER`, `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `MYSQL_HOST_PORT`, `BACKEND_HOST_PORT`.

**Facoltative oggi**

| Variabile | A cosa serve oggi |
|---|---|
| `TICKETMASTER_API_KEY` | import eventi Ticketmaster **manuale** ereditato dal backend originale. Chiave gratuita dal portale sviluppatori Ticketmaster. Senza chiave il resto dell'app funziona. |
| `GOOGLE_GEOCODING_API_KEY` | fallback di geocodifica dell'import quando Ticketmaster non dà coordinate valide. Chiave **server**, separata da quella del browser, ristretta alla sola Geocoding API. |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | solo l'anteprima ADMIN Spotify (`/api/admin/spotify/anteprima`). Senza queste chiavi quella route risponde 503 e il resto funziona. **Non servono per avviare o usare il progetto.** |

**Serviranno alle funzioni future** (non ancora presenti in `.env.example`)

| Chiave / configurazione | Per che cosa |
|---|---|
| Chiave **browser** Google Maps JavaScript API | Mappa della pagina Eventi. È visibile nel browser: va protetta con restrizioni (referrer HTTP per `localhost` e i domini previsti, restrizione all'API), non trattata come segreta. Servizio e fatturazione vanno attivati nel progetto Google Cloud secondo i requisiti in vigore. |
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
- **Password:** hash **bcrypt** con costo 12; il backend non salva password in chiaro.
- **Sessioni (ereditate):** login con `X-Device-Id` (UUID), token bearer di 256 bit; nel DB è salvato solo lo **SHA-256** del token, non il token. Una sola sessione per dispositivo; durata 30 giorni. Per il browser la strategia definitiva (cookie HttpOnly + CSRF oppure bearer con memorizzazione documentata) è **ancora da decidere**.
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
| Eventi e novità | `/eventi`, `/novita` | pubblico; alcune viste dipendono dalla sessione |
| Account | `/auth/login` e logout | login pubblico |
| Follow | `/artisti/:id/segui` | autenticato |
| Playlist | `/playlist` | autenticato, per utente |
| Deezer | `/deezer/scopri` | autenticato |
| ADMIN | `/admin/eventi` (coda di revisione), `/admin/spotify/anteprima`, `/admin/deezer/anteprima` | ADMIN |

Non esistono ancora le route di registrazione, ricerca Apple live, sincronizzazione Ticketmaster automatica né revisione AI.

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
│   └── test/                   # suite (190 test) e guardie dell'ambiente
└── CLAUDE.md                   # linee guida di progetto
```

Non c'è `frontend/`: non è ancora stato creato.

## Limiti noti

Cose **non verificate** o con difetti noti:

- **Secondo avvio non verificato.** Non è ancora stato provato ripetere `docker compose up` sullo stack normale con il volume già popolato. Restano da confermare che `db/init` non venga rieseguito, che `admin-init` riconosca l'ADMIN esistente senza modificarlo (id, hash e conteggi invariati) e che backend e `/health` restino funzionanti. Il codice di `creaAdmin.js` è pensato per questo, ma non l'ho eseguito due volte.
- **Volume anonimo del servizio `seed-test`.** L'immagine `mysql:8.4` dichiara `VOLUME /var/lib/mysql`, quindi ogni creazione del container `seed-test` genera un **volume anonimo** inutilizzato e senza label. Non danneggia gli altri volumi ma si accumula. Correzione proposta e **non ancora applicata**: dichiarare `/var/lib/mysql` come `tmpfs` per quel servizio. Si può rimuovere a mano dopo aver controllato con `docker volume ls` che non sia usato.
- **Guardia SQL del seed di test:** verificata su un container MySQL 8.4 temporaneo (fallisce prima di scrivere se il DB non è `waveset_test` o se non c'è un DB selezionato). Non è coperta dalla suite automatica.
- **Login dell'ADMIN via API non provato** nell'ambiente normale; `npm test` non è mai eseguito sul DB normale.
- **`/health` espone il messaggio d'errore del database. Non corretto.** Quando il database non è raggiungibile, `GET /health` risponde 503 e include nel corpo il testo dell'errore del driver (`backend/src/routes/salute.js`). È un dettaglio interno che non dovrebbe essere esposto: è un limite noto e **ancora da sistemare**, non risolto.
- **Import Ticketmaster manuale** e script di importazione del catalogo reale: ereditati, non provati in questa sessione e non collegati a nessuno scheduler.
- **Preflight:** `lsof` può non vedere socket di altri utenti; su un Mac con un solo utente è sufficiente.
- **Versione di Node per la suite:** testata solo con Node 26. Il requisito minimo non è stato determinato e non va dedotto da questa prova (vedi [Prerequisiti](#prerequisiti)).
- **Immagini demo:** il catalogo demo usa segnaposto picsum.photos, che il progetto vieta per il frontend definitivo.
- **Cronologia Git:** al momento della scrittura il repository non ha ancora commit.

## Funzionalità future e riferimenti

Funzionalità previste (vedi [Da implementare](#da-implementare)): frontend web «Club», registrazione USER, ricerca Apple live e promozione controllata nel catalogo, tendenze Apple, scheduler Ticketmaster con un solo esecutore, Google Maps con quattro layer, revisione ADMIN assistita da Ollama locale.

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
