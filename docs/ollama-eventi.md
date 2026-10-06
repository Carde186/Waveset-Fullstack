# Validazione automatica degli eventi con Ollama

Ticketmaster importa gli eventi in `da_valutare`; il worker backend valuta ogni relazione con gli artisti locali. Sicuro → approva, incerto o errato → rifiuta. Il modello usa i dati salvati e il backend verifica la decisione prima della pubblicazione.

## Configurazione

Per installazione, modello e avvio consulta il [README](../README.md#avvio-locale). Configurazione server in `.env`:

| Variabile | Default o valore locale |
| --- | --- |
| `OLLAMA_URL` | `http://ollama:11434`, nella rete Compose. |
| `OLLAMA_MODEL` | `qwen3:4b`, scaricato automaticamente da `ollama-model`. |
| `OLLAMA_TIMEOUT_MS` | 120000 in Compose. |
| `OLLAMA_SOGLIA_CONFIDENZA` | 0.85 |
| `OLLAMA_MAX_TENTATIVI` | 3 |
| `OLLAMA_CONCORRENZA` | 1, configurabile da 1 a 4. |
| `OLLAMA_INTERVALLO_MS` | 30000 |
| `OLLAMA_LOTTO` | 20 |

Compose avvia il server `ollama`, conserva il modello nel volume `ollama_data` e attende il download prima di avviare backend e `ollama-eventi`. Non espone la porta Ollama sull'host. Il worker è separato dalla sync Ticketmaster: un lock MySQL consente un solo worker per DB e l'applicazione delle decisioni è seriale. Le variabili Ollama sono solo server. Per un backend avviato direttamente sull'host, configura il suo server Ollama e usa `http://localhost:11434`.

Con Docker Desktop puoi riusare un server Ollama già attivo sull'host usando `http://host.docker.internal:11434`: `ollama-model` salta il download locale e il modello va già predisposto su quel server.

Dalla root, con stack già avviato:

```bash
docker compose exec -T backend npm run ollama:check
docker compose logs --tail=50 ollama-eventi
# Ciclo manuale opzionale: usa lo stesso lock del worker.
docker compose exec -T backend npm run eventi:valida
```

Se il lock è occupato, lascia completare il worker. Per l'ambiente isolato usa `.env.test`, `docker-compose.test.yml` e DB `waveset_test`.

## Schema e migrazione

Il servizio `ollama-schema` applica `16_ollama_eventi_schema.sql`: estende gli stati evento, crea job e audit e mette in valutazione i Ticketmaster esistenti. Prima di aggiornare un DB in uso, salva un backup, ferma i worker e leggi la migrazione; MySQL DDL esegue commit impliciti.

Compose prepara lo schema all'avvio. La migrazione è idempotente: non rimette in coda i job conclusi e conserva stato precedente, snapshot e dati curati. Le vecchie decisioni manuali non autorizzano la pubblicazione automatica.

## Contratto e regole di approvazione

Il client usa `/api/chat` con JSON Schema, `stream:false`, `think:false`, temperatura 0 e massimo 512 token. La versione del prompt è `waveset-relazione-v4`. La risposta deve contenere esattamente:

| Campo | Validazione |
| --- | --- |
| `decisione` | `approva` o `rifiuta`. |
| `confidenza` | Numero finito da 0 a 1. |
| `artista_corrispondente` | Booleano. |
| `possibile_duplicato` | Booleano. |
| `motivazione` | Frase prevista dallo schema dinamico, massimo 400 caratteri. |

Lo schema separa con `anyOf` le motivazioni di approvazione da quelle di rifiuto. Se i controlli backend rilevano requisiti mancanti, ammette solo il rifiuto con il motivo specifico. Una risposta contraddittoria resta rifiutata; il nuovo prompt provoca automaticamente la rivalutazione dei job, conservando lo storico.

Per pubblicare, il backend richiede soglia superata, artista corrispondente, assenza di duplicati, profilo Deezer coerente e identità Ticketmaster confermata o corrispondenza esatta unica verificata. L'attraction deve comparire nell'evento con nome coerente.

Dati insufficienti, identità ambigua, risposta non conforme, annullamenti/posticipi o contraddizioni con i dati curati causano rifiuto. Festival e titoli generici seguono gli stessi controlli. Per una lineup con più artisti locali, tutte le relazioni devono essere approvate.

Gli input includono profili, identità, evento, venue e possibili duplicati; escludono credenziali e dati degli utenti. La motivazione viene registrata, ma non sostituisce i controlli deterministici.

## Tentativi, audit e rivalutazione

Errori di rete, HTTP, timeout o modello assente mantengono `da_valutare`, con backoff iniziale di 60/120 secondi. Raggiunto `OLLAMA_MAX_TENTATIVI`, il job termina con rifiuto tecnico. Risposte JSON invalide vengono rifiutate subito. Il tentativo è prenotato prima della chiamata: riavviare il worker non azzera il contatore.

`ollama_evento_job` conserva stato, generazione, hash e tentativi; `ollama_evento_audit` conserva input minimizzato, risposta, modello, motivazione ed errori. Input invariati e job conclusi non generano nuove inferenze. Cambi sostanziali a snapshot, profilo, modello o prompt richiedono rivalutazione; immagini e timestamp sync non la richiedono. Risultati divenuti obsoleti non vengono pubblicati.

`/admin/eventi` mostra il registro; il dettaglio include lo storico. **Rivaluta con Ollama** invia `POST /api/admin/eventi/:id/rivaluta` e restituisce 202. Richieste ripetute su un job già pendente non azzerano i tentativi. L'ADMIN richiede la rivalutazione; la decisione resta automatica.

Le API pubbliche richiedono `evento.stato='pubblicato'` e, per Ticketmaster, `job.stato='approva'`, oltre ai filtri di data e annullamento. Catalogo, lineup e identità curate non vengono sovrascritti dal modello.

## Verifica

Le suite standard simulano Ollama; i test di persistenza usano solo `waveset_test`, con fixture temporanee e worker fermo. Le prove con il modello reale sono separate da `npm test`.

Implementazione in `backend/src/ollama/`; riferimenti ufficiali: [Docker](https://docs.ollama.com/docker), [Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs) e [Chat API](https://docs.ollama.com/api/chat).
