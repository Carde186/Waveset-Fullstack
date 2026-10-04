# Validazione automatica Ticketmaster con Ollama

Deezer è il provider artisti predefinito; Apple Music resta opzionale. Ticketmaster fornisce gli eventi; Ollama valuta **solo la relazione evento–artista**, usando dati già salvati. Nessuna chiamata frontend a Ollama, API key AI, fonte esterna consultata dal modello o fallback cloud. Non è una revisione manuale: sicuro → approva, incerto/errato → rifiuta.

## Setup locale

Installare e avviare Ollama sul Mac; il modello consigliato per sviluppo è `qwen3:4b`. `OLLAMA_MODEL` è configurabile: hardware più potente può usare modelli più grandi che rispettino lo stesso JSON Schema. Il progetto non scarica automaticamente modelli.

```sh
ollama pull qwen3:4b
ollama list
curl http://localhost:11434/api/tags
```

In `.env` (solo backend, mai `VITE_*`):

```dotenv
# Backend Docker su macOS
OLLAMA_URL=http://host.docker.internal:11434
# Backend sul Mac: OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:4b
OLLAMA_TIMEOUT_MS=45000
OLLAMA_SOGLIA_CONFIDENZA=0.85
OLLAMA_MAX_TENTATIVI=3
OLLAMA_CONCORRENZA=1
OLLAMA_INTERVALLO_MS=30000
OLLAMA_LOTTO=20
```

Per il Compose test impostare gli stessi valori in `.env.test` locale. `ARTISTI_PROVIDER` sceglie il profilo attivo. URL e modello sono obbligatori, le altre variabili hanno i default sopra. Configurazione validata al primo avvio del comando; readiness interna tramite `/api/tags`, controlla il nome esatto installato. Non esiste un endpoint pubblico di proxy o health Ollama. Limitare la concorrenza a 1 su laptop; valori ammessi 1–4. Ollama deve essere raggiungibile dal container; non pubblicare la porta 11434 su Internet.

## Migrazione e avvio

Prima di migrare un volume esistente, fare backup, fermare i worker Ticketmaster/Ollama e leggere `backend/db/init/16_ollama_eventi_schema.sql`: due CREATE IF NOT EXISTS, estensione ENUM evento con `da_valutare`, inserimento dei job mancanti e messa in valutazione dei Ticketmaster esistenti. **Le vecchie decisioni manuali non autorizzano pubblicazione automatica**: stato e motivo precedenti sono conservati nel job. Campi curati, collegamenti confermati, immagini e snapshot non sono eliminati né riscritti. MySQL DDL effettua commit implicito: il backup è necessario per rollback operativo.

```sh
# Sviluppo Docker (le dipendenze preparano schema 13,14,15,16)
docker compose --env-file .env -f docker-compose.yml build backend ollama-schema ollama-eventi ticketmaster-sync
docker compose --env-file .env -f docker-compose.yml up -d
# Test: usare .env.test, docker-compose.test.yml e -p waveset-test
```

Il servizio `ollama-schema` salta l'ALTER se l'ENUM è già esteso; rieseguire la migrazione non rimette in coda i job conclusi. Worker `ollama-eventi` indipendente dal worker Ticketmaster e dall'HTTP: avvio automatico, controllo ogni 30 secondi, lotto massimo 20, un solo esecutore tramite lock MySQL per database. Concorrenza delle inferenze limitata e applicazione seriale: due eventi con stessa data/venue non vengono approvati contemporaneamente come duplicati.

```sh
# Host, da backend/, con DB_HOST/DB_PORT/DB_NAME configurati per il Mac
node --env-file=../.env scripts/preparaOllama.js --applica
node --env-file=../.env scripts/validaEventiOllama.js --check
node --env-file=../.env scripts/validaEventiOllama.js
node --env-file=../.env scripts/validaEventiOllama.js --continuo
# Alias npm: eventi:ollama-schema, ollama:check, eventi:valida, eventi:validazione-worker
# Le variabili devono essere caricate dal processo o da .env nella cwd.
# Manuale Docker con configurazione e DB già pronti:
docker compose --env-file .env -f docker-compose.yml run --rm --no-deps ollama-eventi node scripts/validaEventiOllama.js
```

## Contratto e sicurezza della decisione

`/api/chat` usa `format` con JSON Schema, `stream:false`, `think:false`, temperatura 0, massimo 512 token di risposta. Schema copiato anche nel prompt (`waveset-relazione-v3`), senza tools. Il backend verifica esattamente cinque campi, senza proprietà extra:

```json
{"decisione":"approva","confidenza":0.95,"artista_corrispondente":true,"possibile_duplicato":false,"motivazione":"Evento EVENTO_ID: attraction ATTRACTION_ID coerente con l’identità Ticketmaster verificata di NOME_ARTISTA; nessun duplicato rilevato."}
```

La motivazione è ulteriormente vincolata con `enum` dinamico a frasi brevi che includono ID evento e nome artista, costruite esclusivamente dai dati normalizzati. La frase di corrispondenza include l'ID attraction ed è ammessa solo quando i controlli deterministici lo corroborano. Altre frasi esprimono incertezza/insufficienza o possibile duplicato, senza affermare fatti mancanti. Il modello continua a decidere approva/rifiuta e confidenza; non può aggiungere affermazioni inventate sul titolo. Una motivazione fuori enum è rifiutata. Questo vincolo risolve una falsa affermazione osservata nella prova live qwen3:4b sul titolo Haunted, conservata nel precedente audit v2.

Confidenza numerica finita 0–1; due booleani reali; motivazione non vuota ≤400 caratteri. JSON incompleto/invalido, risposta assente o violazione schema causano rifiuto immediato con errore auditato. Gli errori HTTP/rete/timeout/modello mancante/readiness mantengono `da_valutare`, con backoff 60/120 secondi; al terzo tentativo fallito (configurabile) rifiuto tecnico. Ogni tentativo è prenotato prima della rete: un riavvio non azzera il limite, un tentativo interrotto viene registrato. Nessun retry HTTP nascosto oltre il contatore persistente.

Un'approvazione del modello non basta. Il backend richiede: soglia superata, artista corrispondente, nessun duplicato, profilo provider esistente e nome coerente; ID attraction confermato o unica attraction esatta della verifica `trovato` non ambigua, presente nell'evento con nome coerente. `non_trovato`/`non_verificato` senza identità confermata forte → rifiuto. Eventi annullati/posticipati, data incerta, fonte sconosciuta, dati minimi mancanti o fonte in contraddizione con correzioni curate → rifiuto. Festival/B2B/ft./titoli generici non sono esclusi a priori: richiedono la stessa corrispondenza forte. Il testo libero della motivazione è del modello e non costituisce prova; la pubblicazione usa solo campi validati e controlli deterministici.

Per lineup con più artisti **locali**, valutare ogni relazione e pubblicare soltanto se tutte sono sicure. È una scelta prudente: nessun artista erroneamente associato entra nel filtro follow senza cancellare collegamenti esistenti. Gli altri partecipanti Ticketmaster sono inviati come attraction, non devono essere importati nel catalogo. Generi/fan opzionali, nessuna assunzione che Deezer fornisca generi.

Payload consentito: nome locale/provider, ID, URL pubblico, fan/generi disponibili; esito verifica attraction/omonimi/ID confermato; evento/data/ora/venue/città/paese, attraction/lineup; massimo 20 eventi pubblicati con stessa data/venue. Paese conservato nei nuovi snapshot normalizzati; vecchi snapshot senza paese inviano null. Nessun utente/sessione/cookie/Authorization, immagini/payload provider grezzo o chiave Ticketmaster. Solo il contenuto della risposta modello è auditato, non header né catena di pensiero.

## Idempotenza, audit, visibilità

`ollama_evento_job`: un job per evento, generazione, hash input+prompt+modello, contatore e prossimo tentativo, esito finale, motivazione/errore e vecchio stato. `ollama_evento_audit`: una riga per artista/generazione/tentativo, input minimizzato JSON/hash, modello/versione prompt, raw JSON, decisione/confidenza/motivazione/errore, decisione applicata e timestamp. Dettaglio audit visibile solo ADMIN.

Input identico e job concluso → nessuna nuova inferenza. Cambi sostanziali di snapshot invalidano immediatamente l'esito precedente in fase sync, mentre cambi del profilo/provider sono rilevati dal worker al ciclo successivo. Immagini e timestamp sync non richiedono rivalutazione. Modello o versione prompt cambiati generano una nuova valutazione. Fonte cambiata durante inferenza → risultato obsoleto non pubblicato. Nessuna valutazione sovrascrive `artista.id_ticketmaster`, lineup o dati curati. La sync resta asincrona e non aspetta Ollama.

Public API condivise da Esplora, Eventi, dettaglio, artista e mappa richiedono `evento.stato='pubblicato'` **e** `job.stato='approva'` per Ticketmaster. Catalogo manuale invariato; annullamenti ufficiali comunque esclusi. `/admin/eventi` è registro di tutti gli esiti, `/admin/eventi/:id` include storico. `GET /api/admin/eventi/registro`, `GET /api/admin/eventi/:id` e precedente `/:id/fonte` sono ADMIN/no-store. `POST /api/admin/eventi/:id/rivaluta` restituisce 202 `{"evento_id":123,"stato":"da_valutare"}`; richieste ripetute già pendenti non azzerano tentativi. Approva/scarta/rifiuta, correzione evento e conferma-collegamento legacy nel registro restituiscono 410; non esiste bypass manuale. La gestione profili artisti separata resta disponibile.

## Test

Test standard mockano Ollama. `node --test test/ollamaSenzaDb.test.js` e `test/adminEventiSenzaDb.test.js`; DB isolato: `node --env-file=../.env.test --test test/ollamaPersistenza.test.js`, con worker fermo, fixture temporanee ripulite, HTTP pubblico e lock reali. La prova live è separata ed esplicita, mai parte di npm test. Report locale in `/private/tmp/waveset-ollama/` (non versionato); backup privati non vanno pubblicati.

Riferimenti ufficiali: [Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs), [Chat](https://docs.ollama.com/api/chat), [List models](https://docs.ollama.com/api/tags).
