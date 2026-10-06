# Artisti Deezer e presenza Ticketmaster

Per avvio e chiavi consulta il [README](../README.md#avvio-locale). Deezer fornisce i profili artisti; Ticketmaster gli eventi. I metadati del provider sono separati da nome, biografia e generi curati nel catalogo locale.

## Collegamento da ADMIN

1. Accedi su `http://localhost:5174/admin/artisti` con l'ADMIN configurato in `.env`.
2. Apri un artista e premi **Cerca artista**. Confronta nome, foto, fan e link Deezer per distinguere gli omonimi.
3. Seleziona il risultato corretto, premi **Verifica collegamento**, poi **Conferma e salva**. Anche la sostituzione di un profilo richiede conferma esplicita.
4. Se Ticketmaster presenta omonimi, confronta profili e riferimenti, seleziona l’identità corretta e usa **Verifica identità Ticketmaster → Conferma e salva identità**. Puoi sostituire o rimuovere la scelta; gli eventi tornano alla valutazione automatica, senza cancellare lo storico.
5. Usa **Risincronizza metadati** per aggiornare il profilo già scelto e **Ricontrolla Ticketmaster** per ripetere il controllo della presenza.

La lista ADMIN include anche artisti senza collegamento e demo. La ricerca non crea artisti né collega automaticamente il primo risultato. Il seed 17 aggiunge soltanto i 33 nomi; su un volume esistente gli script di init non vengono rieseguiti.

## Configurazione e persistenza

| Variabile | Uso |
| --- | --- |
| `ARTISTI_PROVIDER=deezer` | Unico provider supportato; valori sconosciuti restituiscono 503. |
| `DEEZER_TIMEOUT_MS=8000` | Timeout per tentativo, configurabile tra 10 e 30000 ms. |
| `TICKETMASTER_API_KEY` | Chiave server per il controllo della presenza e la sincronizzazione eventi. |

Deezer usa un'API pubblica senza chiave. Il client limita le chiamate a 8 al secondo, mantiene le ricerche in cache per 60 secondi e consente un retry limitato per errori temporanei. Cache e limite sono per processo; la conferma rilegge sempre il dettaglio dalla fonte.

`artista_provider_link` conserva ID esterno, URL, foto, fan, generi disponibili, timestamp e versione. Un solo link per artista/provider e identità esterna univoca; `storefront` è vuoto per Deezer. Il JSON grezzo rimane nel DB. Fan assenti restano null e generi assenti restano vuoti.

Le scritture verificano `versione_attesa`: una conferma obsoleta restituisce 409. La sync aggiorna l'ID già scelto. I profili di integrazioni ritirate sono conservati ma non utilizzati.

## API ADMIN

Percorsi relativi a `/api/admin/artisti`. Richiedono sessione ADMIN; i POST richiedono CSRF e origine consentita. Le risposte usano `Cache-Control: no-store`.

| Metodo e percorso | Risultato o corpo |
| --- | --- |
| `GET /` | Elenco locale con `provider_collegato`. |
| `GET /provider` | Provider attivo. |
| `GET /:id/provider` o `/:id/deezer` | Artista locale e collegamento, oppure null. |
| `GET /:id/deezer/search?q=nome` | Profili candidati, senza scritture. |
| `POST /:id/deezer/collegamento` | `external_id` e `versione_attesa` (null al primo link). |
| `POST /:id/deezer/ticketmaster/collegamento` | `attraction_id` (null per rimuovere), `attraction_attesa` e `versione_attesa`. |
| `POST /:id/deezer/sincronizza` | `versione_attesa` corrente. |
| `POST /:id/deezer/ticketmaster` | `versione_attesa` corrente. |

## Presenza Ticketmaster informativa

Il controllo cerca le attraction per nome completo normalizzato. Gli esiti sono `trovato`, `non_trovato` e `non_verificato`; più identità corrispondenti producono `ambiguo=true`. La ricerca ha un budget di 5 secondi e massimo 3 pagine: errori o risultati incompleti danno `non_verificato`.

La presenza di un'attraction **non garantisce eventi futuri**. Il ricontrollo non modifica l’identità confermata e un errore non annulla il collegamento Deezer. Solo la conferma esplicita aggiorna `artista.id_ticketmaster`: il server verifica nuovamente il candidato, la versione del profilo e la scelta precedente. Un’identità non può essere assegnata a due artisti locali. L'esito è associato alla versione del profilo: risposte tardive non sovrascrivono un link sostituito.

La sync eventi considera gli artisti locali, anche senza Deezer. Collegare prima i profili fornisce i dati necessari alla [validazione Ollama](ollama-eventi.md). Comandi di sincronizzazione nel [README](../README.md#comandi-utili).

## Schema e manutenzione

Compose prepara le tabelle tramite `artisti-provider-schema`. Le migrazioni 14 e 15 sono applicate da `preparaProviderArtisti.js` con lock MySQL; il nome storico `14_apple_music_provider_schema.sql` identifica lo schema condiviso usato da Deezer.

Su un DB esistente salva prima un backup e leggi i due SQL. Con MySQL già avviato, dalla root:

```bash
docker compose build backend artisti-provider-schema
docker compose run --rm --no-deps artisti-provider-schema
docker compose up -d --no-deps backend
```

Le migrazioni sono idempotenti e conservano i link. Le suite usano il DB isolato `waveset_test` e fonti simulate. Foto e copertine sono descritte nel [catalogo pubblico](catalogo-pubblico.md#immagini-e-copertine); prima della pubblicazione consulta le [condizioni Deezer](https://developers.deezer.com/termsofuse).
