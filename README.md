# Waveset Fullstack

Waveset è un'app web per scoprire artisti di musica elettronica e i loro eventi, consultarne la discografia e seguire i propri preferiti.

## Indice

- [Funzionalità](#funzionalità)
- [Tecnologie e fonti](#tecnologie-e-fonti)
- [Avvio locale](#avvio-locale)
- [Account e sicurezza](#account-e-sicurezza)
- [Chiave API Ticketmaster](#chiave-api-ticketmaster)
- [Chiave API Google Maps e Map ID](#chiave-api-google-maps-e-map-id)
- [Primo avvio](#primo-avvio-completare-foto-discografia-ed-eventi)
- [Flusso artisti ed eventi](#flusso-artisti-ed-eventi)
- [Comandi utili](#comandi-utili)
- [Problemi comuni](#problemi-comuni)
- [Test](#test)
- [Limiti noti](#limiti-noti)
- [Funzionalità future](#funzionalità-future)
- [Documentazione tecnica](#documentazione-tecnica)
- [Riferimenti](#riferimenti)

## Funzionalità

- **Esplora:** ricerca degli artisti per nome, catalogo di artisti reali, filtri per genere e prossimi eventi.
- **Profilo artista:** foto, biografia, fan su Deezer, 10 brani popolari e album, singoli ed EP con copertine e link Deezer.
- **Eventi:** lista e dettaglio con copertine Ticketmaster, filtri per genere e artisti seguiti, conservati durante la navigazione.
- **Mappa:** Google Maps con marker fotografici degli artisti, sincronizzati con la lista; modalità Standard, Scura, Satellite e Ibrida.
- **Account:** registrazione, accesso, logout, cambio email e password, pagina degli artisti seguiti.
- **ADMIN:** collegamento degli artisti a Deezer e registro delle valutazioni automatiche degli eventi.
- **Interfaccia:** responsive, tema chiaro/scuro e lingua IT/EN con preferenza salvata.

## Tecnologie e fonti

| Area | Tecnologia / fonte |
| --- | --- |
| Frontend | React, TypeScript, Vite, CSS Modules |
| Backend | Node.js, Express |
| Database | MySQL 8.4 |
| Ambiente locale | Docker Compose; nginx serve il frontend e inoltra le API |
| Artisti e discografia | Deezer, senza chiave API |
| Eventi e copertine | Ticketmaster Discovery API |
| Mappa | Google Maps JavaScript API |
| Validazione eventi | Ollama, modello locale configurabile |

## Avvio locale

Servono **Git**, **Docker Desktop** avviato e una connessione Internet per immagini Docker, modello e fonti esterne. Ollama viene eseguito da Compose: non occorre installarlo sull'host. Per `qwen3:4b` assegna almeno **8 GB di RAM a Docker Desktop**; la validazione su CPU può richiedere tempo.

```bash
git clone https://github.com/Carde186/Waveset-Fullstack.git
cd Waveset-Fullstack
```

I comandi seguenti vanno eseguiti **dalla root del progetto**. Docker installa le dipendenze e costruisce backend e frontend: non serve avviare Vite separatamente.

1. Dalla root del progetto, crea `.env` dal modello **solo se non esiste già**:

   ```bash
   test -f .env || cp .env.example .env
   ```

2. Compila `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (almeno 12 caratteri). Mantieni `ARTISTI_PROVIDER=deezer` e configura le chiavi Ticketmaster e Maps descritte sotto.

   Usa `OLLAMA_URL=http://ollama:11434` e `OLLAMA_MODEL=qwen3:4b`. Se aggiorni un vecchio `.env`, sostituisci l'URL precedente e imposta `OLLAMA_TIMEOUT_MS=120000`. Per prove su hardware limitato puoi scegliere `qwen3:0.6b`: consuma meno memoria, ma può produrre valutazioni meno accurate.

   Se hai già Ollama attivo sull'host con il modello installato, Docker Desktop può riusarlo impostando `OLLAMA_URL=http://host.docker.internal:11434`. In questo caso Compose non scarica una seconda copia del modello; l'avvio interamente in Docker resta la configurazione predefinita.

3. Avvia lo stack:

   ```bash
   docker compose up --build
   ```

   Il comando avvia MySQL e Ollama, scarica il modello se assente, prepara gli schemi, crea l’ADMIN e avvia frontend, backend e worker. Il primo download può richiedere diversi minuti; backend e frontend attendono il modello. I volumi conservano database e modello tra gli avvii.

4. Apri **http://localhost:5174**. Per accedere come ADMIN usa le credenziali configurate precedentemente in `.env`; gli utenti possono registrarsi dall'app.

| Servizio | Indirizzo predefinito |
| --- | --- |
| App web | http://localhost:5174 |
| Backend | http://localhost:3002 |
| MySQL | 127.0.0.1:3307 |

Su un volume nuovo, gli script in `backend/db/init/` creano schema e dati iniziali, incluso il seed `17_artisti_waveset.sql` con 33 artisti elettronici reali. L'ADMIN viene creato automaticamente. Gli artisti demo sono conservati nel DB e nella gestione ADMIN, ma nascosti dalle pagine pubbliche. I collegamenti Deezer vanno confermati da ADMIN: i volumi locali non sono inclusi nel repository.

Per attivare i generi degli artisti del seed, esegui prima l'anteprima, poi l'applicazione delle sole associazioni mancanti; su un DB esistente conserva prima un backup:

```bash
docker compose exec -T backend npm run catalogo:classifica
docker compose exec -T backend npm run catalogo:classifica -- --applica
```

## Account e sicurezza

- Su un ambiente nuovo esiste **solo l'ADMIN** (creato in modo idempotente da `backend/scripts/creaAdmin.js` con le credenziali di `.env`). Gli utenti si registrano da soli come `USER`: il ruolo è deciso dal server.
- Password hashate con bcrypt, sessioni lato server, cookie HttpOnly con protezione CSRF, rate limit su registrazione e login.
- Ogni utente vede e modifica solo i propri dati (follow e account); le route `/api/admin/*` sono riservate ad ADMIN.

## Chiave API Ticketmaster

Per abilitare la sincronizzazione automatica degli eventi da Ticketmaster è necessaria una chiave API. Segui questi passi:

1. **Vai sul portale sviluppatori Ticketmaster**

   URL: [https://developer.ticketmaster.com/](https://developer.ticketmaster.com/)

2. **Crea un account**

   - Clicca su “Sign Up” o “Register”.
   - Compila il form con email, password e dati richiesti.
   - Verifica l’email se richiesto.

3. **Accedi e crea una nuova applicazione**

   - Dopo il login, apri il menu del profilo in alto a destra.
   - Nel menu del profilo, clicca su “My Apps”.
   - Aggiungi una nuova applicazione.
   - Inserisci il nome dell'applicazione (es. “Waveset”). Descrizione e sito web non sono obbligatori.

4. **Ottieni la chiave API**

   - Una volta creata l’app, clicca su di essa e salva la chiave **Consumer Key**.

5. **Configura la chiave in ambiente locale**

   - Per lo sviluppo, nel file `.env` (solo locale, non versionato) aggiungi:
     ```env
     TICKETMASTER_API_KEY=tua_chiave_reale
     ```
   - I test standard del client Ticketmaster usano risposte simulate e non richiedono la chiave reale.
   - Non condividere mai questa chiave nel repository o in luoghi pubblici.

Dopo aver aggiunto o modificato la chiave in `.env`, aggiorna i container dalla root del progetto affinché backend e worker ricevano il nuovo valore:

```bash
docker compose --env-file .env up -d --build
```

Poi puoi eseguire la sincronizzazione manuale:

```bash
docker compose --env-file .env exec -T backend npm run eventi:sync
```

Il solo comando `exec` non aggiorna le variabili d'ambiente del container già in esecuzione.

Gli eventi importati vengono valutati automaticamente da Ollama prima della pubblicazione, come descritto nel flusso artisti ed eventi.

## Chiave API Google Maps e Map ID

1. Apri [Google Cloud Console](https://console.cloud.google.com/), accedi con il tuo account Google e seleziona "Inizia gratuitamente" nella pagina principale.
2. Configura un account di fatturazione con un metodo di pagamento valido e collegalo al progetto Google Cloud. Maps JavaScript API richiede la fatturazione attiva: l'utilizzo può rientrare nelle soglie gratuite previste, ma può generare costi al loro superamento.
3. Quando torni alla pagina principale, clicca su **My First Project** in alto a sinistra e seleziona **Nuovo progetto** in alto a destra.
4. Scegli un nome per il progetto (es. "Waveset"), lascia invariate le opzioni **Organizzazione** e **Risorsa padre**, poi clicca su **Crea**.
5. Una volta creato il progetto, selezionalo nelle notifiche in alto a destra, poi seleziona il link **Stai lavorando al progetto** al centro dello schermo.
6. Nel menu a sinistra, clicca su **API e servizi → Libreria** e abilita **Maps JavaScript API**.
7. Apri **API e servizi → Chiavi e credenziali** e clicca su **Mostra chiave**.
8. Limitala ai **Siti web / referrer HTTP**, autorizzando `http://localhost:5174/*`, e alla sola **Maps JavaScript API**.
9. In **Google Maps Platform → Gestione mappe**, crea un **Map ID** di tipo **JavaScript**.
10. Inserisci i due valori nel `.env` locale:
   ```dotenv
   VITE_GOOGLE_MAPS_API_KEY=INSERISCI_LA_TUA_CHIAVE
   VITE_GOOGLE_MAPS_MAP_ID=INSERISCI_IL_TUO_MAP_ID
   ```

Ricostruisci il frontend, perché Vite incorpora questi valori durante la build:

```bash
docker compose up --build
```

La chiave Maps è visibile nel browser e deve avere le restrizioni indicate. Senza configurazione, la lista eventi rimane disponibile. `.env` e `.env.test` restano fuori da Git.

Riferimenti: [configurazione della chiave Maps](https://developers.google.com/maps/documentation/javascript/get-api-key) e [creazione del Map ID](https://developers.google.com/maps/documentation/javascript/map-ids/get-map-id).

## Primo avvio: completare foto, discografia ed eventi

Su un database nuovo, il seed aggiunge 33 artisti elettronici reali con il solo nome, senza foto né collegamenti Deezer. Sono presenti anche dati dimostrativi, esclusi dalle pagine pubbliche. Gli artisti reali possono comparire nel catalogo anche senza collegamento Deezer; la conferma del profilo corretto serve ad aggiungere foto e discografia. Per usare i filtri per genere, esegui la classificazione descritta nella sezione Avvio locale. Gli eventi reali vengono importati da Ticketmaster e pubblicati dopo la validazione di Ollama.

1. Accedi come ADMIN con le credenziali di `.env`.
2. Apri **Gestione artisti** (`/admin/artisti`) e scegli un artista.
3. Cerca il suo profilo su Deezer e **conferma** quello corretto (attenzione agli omonimi). Dopo la conferma diventano disponibili foto e discografia, quando presenti nella fonte.
4. Il worker Ticketmaster cerca e importa gli eventi degli artisti presenti nel database locale, normalmente ogni 8 ore. Per non aspettare, lancia la sincronizzazione manuale:
   ```bash
   docker compose exec -T backend npm run eventi:sync
   ```
5. Ollama deve essere attivo: valuta gli eventi e pubblica solo quelli sicuri. Gli eventi approvati compaiono in **Eventi**, con la mappa se Maps è configurato.

I collegamenti restano nel volume Docker locale: ripetere la procedura serve solo su un database nuovo.

## Flusso artisti ed eventi

1. In `/admin/artisti`, l'ADMIN cerca l'artista su Deezer e conferma il profilo corretto. Il backend controlla anche la presenza dell'artista su Ticketmaster.
2. Il worker Ticketmaster sincronizza gli eventi degli artisti locali, normalmente ogni **8 ore**, conservando snapshot e dati già salvati.
3. Ollama valuta automaticamente la relazione evento–artista; il backend verifica la risposta. **Sicuro → approva; incerto o errato → rifiuta.** Gli errori tecnici vengono riprovati fino al limite configurato.
4. Solo gli eventi Ticketmaster approvati e non annullati vengono pubblicati. `/admin/eventi` mostra decisioni, motivazioni e tentativi; **Rivaluta con Ollama** avvia una nuova valutazione, senza approvazione manuale.

Le foto profilo provengono dal provider artista; le copertine evento da Ticketmaster. Gli ultimi dati salvati restano disponibili quando la fonte ha problemi, con avviso se obsoleti. I fan Deezer non rappresentano il numero di ascolti.

## Comandi utili

```bash
# Riavviare dopo modifiche al codice o alla configurazione
docker compose --env-file .env up -d --build

# Stato dei servizi
docker compose ps

# Sincronizzazione manuale degli eventi
docker compose exec -T backend npm run eventi:sync

# Controllo di Ollama e log dei worker
docker compose exec -T backend npm run ollama:check
docker compose logs --tail=30 ticketmaster-sync ollama-eventi

# Fermare lo stack conservando il database
docker compose stop
```

## Problemi comuni

| Problema | Cosa controllare |
|---|---|
| Docker segnala una porta già occupata | Verifica se un altro servizio usa le porte 5174, 3002 o 3307. Puoi scegliere porte diverse in `.env`; se cambi quella del frontend, aggiorna anche `FRONTEND_ORIGINS` e i referrer autorizzati per Maps. |
| Mancano foto o discografia | Accedi come ADMIN e conferma il profilo Deezer corretto in Gestione artisti. Alcuni dati possono essere assenti anche nella fonte. |
| I filtri per genere non mostrano gli artisti del seed | Esegui l'anteprima e l'applicazione di `catalogo:classifica`, come descritto in Avvio locale. |
| La mappa non compare | Controlla chiave Maps, Map ID e referrer autorizzati. Dopo modifiche alle variabili `VITE_`, ricostruisci il frontend. |
| Non compaiono nuovi eventi | Verifica la chiave Ticketmaster, esegui la sincronizzazione manuale e consulta il registro ADMIN degli eventi. La fonte potrebbe non avere eventi disponibili; quelli importati devono superare la validazione di Ollama. |
| Ollama non risponde | Controlla i log `ollama` e `ollama-model`, la RAM assegnata a Docker e `OLLAMA_URL=http://ollama:11434`. |

Per controllare servizi, modello Ollama e log:

```bash
docker compose ps
docker compose exec -T backend npm run ollama:check
docker compose logs --tail=50 backend ticketmaster-sync ollama ollama-model ollama-eventi
```

Apri l'app usando **http://localhost:5174**: `http://127.0.0.1:5174` è un'origine diversa e non corrisponde alla configurazione predefinita della sessione browser.

## Test

Per eseguire i controlli sull'host, usa **Node.js 22, versione 22.22.2 o successiva della serie 22**, e npm. Questa versione soddisfa i requisiti delle dipendenze frontend attuali. Per il solo avvio tramite Docker non è necessario installare Node.js sull'host.

Controlli frontend:

```bash
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

La suite backend usa esclusivamente **`waveset_test`**, separato dal database di sviluppo. Prepara `.env.test` dal modello solo se non esiste già, compila le password e avvia lo stack isolato (senza worker automatici):

```bash
test -f .env.test || cp .env.test.example .env.test
# Compila le password nel file prima di proseguire.
docker compose --env-file .env.test -f docker-compose.test.yml up -d --build mysql seed-test backend
npm --prefix backend ci
npm --prefix backend test
```

I test standard dei client esterni usano risposte simulate. Il frontend di test è opzionale e usa la porta **5175**; per l'uso normale rimane un'unica app su **5174**.

Per una verifica nel browser sul DB isolato, avvia il frontend con il profilo dedicato:

```bash
docker compose --env-file .env.test -f docker-compose.test.yml --profile browser up -d --build frontend
```

Se vuoi usare Maps in questo ambiente, configura i valori in `.env.test` e autorizza anche `http://localhost:5175/*` nei referrer della chiave.

### Verifica isolata del primo avvio

Con Python 3, dalla root prepara due copie temporanee dei sorgenti attuali:

```bash
python3 scripts/preparaVerificaIsolata.py
```

Il comando stampa una cartella con `app/` e `suite/`. Non avvia servizi: assegna progetti e volumi Docker nuovi, porte separate e password casuali nei file privati. `app/.env` riusa solo chiavi Ticketmaster/Maps e nome del modello; Ollama ha un server e un volume separati. La suite usa fonti simulate. Le porte devono essere libere: app 5175/3027/3327, suite 5275/3028/3328. Se 5175 è occupata, usa `--frontend-port=5274` e autorizza il relativo referrer Maps.

Da `app/` segui Avvio locale, Primo avvio e Comandi utili; `.env` è già preparato. Avvia con `docker compose up -d --build` e apri la porta indicata. Le credenziali ADMIN sono in quel `.env`. Controlla registrazione, ricerca, generi, collegamento Deezer, follow e account su desktop/mobile. La sync è limitata a un artista per ciclo; per quello appena collegato usa il suo ID locale:

```bash
docker compose exec -T backend npm run eventi:sync -- --artisti=ID_ARTISTA --force
docker compose exec -T backend npm run ollama:check
docker compose exec -T backend npm run eventi:valida
```

Consulta `/admin/eventi`, poi Eventi, dettaglio e mappa. I risultati dipendono dalla copertura Ticketmaster e dalla validazione. Riavvia con `docker compose stop` e `docker compose up -d`: account e collegamenti devono persistere.

Ferma prima `app/` con `docker compose stop`, poi da `suite/` esegui i comandi della sezione Test usando il `.env.test` già preparato: le due verifiche in sequenza riducono il consumo di memoria. Al termine ferma anche la suite con `docker compose --env-file .env.test -f docker-compose.test.yml stop`. I volumi restano disponibili per consultare gli esiti. Non eseguire questi comandi nella cartella originale.

## Limiti noti

- Ticketmaster non copre tutti i concerti: il calendario dipende dalla sua copertura e dalla chiave configurata.
- Se la fonte è indisponibile, l'app mostra gli ultimi dati salvati con avviso, non dati "in tempo reale".
- Il numero di fan Deezer non equivale agli ascolti. Spotify Web API **non è necessaria**: restano solo i link Spotify già verificati.
- Il database di sviluppo vive in un volume Docker locale e non è incluso in Git.
- Prima del lancio pubblico leggere le condizioni d'uso di Deezer (immagini, uso commerciale) e di Ticketmaster.

## Funzionalità future

Possibili sviluppi per migliorare la scoperta degli artisti e dei loro eventi:

- Recupero della password tramite e-mail.
- Verifica dell'indirizzo e-mail degli utenti.
- Notifiche per nuovi eventi degli artisti seguiti.
- Ampliamento del catalogo artisti e delle fonti degli eventi.
- Feed delle tendenze basato su dati osservabili e verificabili.

## Documentazione tecnica

- [Artisti Deezer, collegamenti ADMIN e presenza Ticketmaster](docs/provider-artisti.md)
- [Catalogo pubblico, discografia e immagini](docs/catalogo-pubblico.md)
- [Validazione automatica con Ollama](docs/ollama-eventi.md)

## Riferimenti

[Deezer API](https://developers.deezer.com/api) · [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) · [Maps JavaScript API](https://developers.google.com/maps/documentation/javascript) · [Ollama](https://ollama.com/) · [Docker Compose](https://docs.docker.com/compose/)
