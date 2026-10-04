# Ritratti artista e copertine evento

I ritratti seguono la priorità condivisa `provider attivo → immagine locale → grafica Club`. Il hero pubblico dell'artista mostra un ritratto quadrato, fino a 320px, accanto al testo su desktop e sotto il testo su mobile. Si usa la foto provider già esposta dall'API (Deezer `picture_medium`, 250×250), senza nuove richieste o cambi di provider. `object-fit: cover` conserva le proporzioni; il segnaposto ha lo stesso riquadro. I crediti locali restano associati soltanto alla foto locale.

Le copertine provengono **esclusivamente da `images` dell'evento Ticketmaster**, mai da `attractions[].images`, Deezer o dalla lineup. Ticketmaster può fornire la stessa grafica per diversi eventi: Waveset non inventa una locandina alternativa.

## Selezione deterministica

Implementazione unica: `backend/src/ticketmaster/immagini.js`.

1. Scartare immagini con URL non valido, credenziali/query/fragment/porte nell'URL, dimensioni assenti, non intere o fuori 1–20000px. Ammessi soltanto i CDN ufficiali `ticketm.net` e `ticketmaster.com`, inclusi sottodomini; HTTP su questi host viene portato a HTTPS.
2. Se esiste almeno una immagine valida non-fallback, escludere tutte le `fallback: true`.
3. Preferire immagini 16:9 o 3:2, riconosciute dalle dimensioni con tolleranza del 2% per arrotondamenti. Tra queste, preferire una larghezza almeno 1024px e scegliere la più piccola sufficiente; sotto soglia scegliere la più larga.
4. A parità di larghezza preferire 16:9, poi altezza minore e URL in ordine lessicografico. Il risultato non dipende dall'ordine dell'array.
5. Se non esistono immagini valide, salvare `null`. Non usare una foto artista come fallback.

I campi e i rapporti sono quelli della [Discovery API ufficiale](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/). Gli URL vengono usati come immagini pubbliche, senza chiave Ticketmaster o header di autenticazione.

## Persistenza e API pubbliche

Si estende il JSON già presente in `ticketmaster_evento_fonte.snapshot`, senza DDL o nuove colonne SQL:

- `images`: candidati immagine normalizzati, con soli metadati pubblici;
- `immagine`: copertina scelta `{url, width, height, ratio, fallback, source: "ticketmaster"}` oppure `null`.

Importazione manuale e sincronizzazione periodica salvano entrambi i campi. Il repository sync mantiene la copertina nello snapshot della fonte, separato dai campi curati dall'ADMIN: aggiornare la foto non modifica approvazione, collegamenti, titolo, data o luogo protetti. Un errore della fonte conserva lo snapshot precedente. Una risposta valida senza immagini produce `null`.

`GET /api/eventi`, `GET /api/eventi/:id` e gli eventi di `/api/novita` espongono gli stessi campi aggiuntivi:

```json
{
  "immagine_url": "https://s1.ticketm.net/dam/a/esempio.jpg",
  "immagine": {
    "url": "https://s1.ticketm.net/dam/a/esempio.jpg",
    "width": 1024, "height": 576, "ratio": "16_9",
    "fallback": false, "source": "ticketmaster"
  },
  "lineup": [{"id": 5, "nome": "Carl Cox", "immagine_url": "https://cdn-images.dzcdn.net/images/artist/esempio.jpg"}]
}
```

L'esempio mostra solo la struttura, con URL illustrativi. Nel frontend `Evento.immagineUrl` e `Evento.immagine` rappresentano i nuovi campi; risposte precedenti senza copertina rimangono valide. Nessuno snapshot completo viene esposto nelle API pubbliche.

`CopertinaEvento` è condiviso tra lista e dettaglio: card 16:9, angoli Club, `object-fit: cover` e `object-position: center`. Nel dettaglio la cover riempie il pannello destro del hero verde e sostituisce la decorazione; la colonna sinistra determina l’altezza su desktop. Su mobile le informazioni precedono il pannello immagine largo100% e in rapporto16:9. Il fallback occupa lo stesso pannello. Il testo resta su una superficie separata e leggibile. Assenza o errore di caricamento mostra un calendario grafico neutro e il testo IT/EN dedicato. La lineup mantiene le foto artista separate. I marker mantengono foto del primo artista, immagine36px/cerchio40px e fallback preesistente.

Esplora contiene soltanto artisti e brani: non ha card evento da adattare. Nessuna CSP è attualmente configurata; se viene introdotta, `img-src` deve consentire i CDN ufficiali sopra e `cdn-images.dzcdn.net` per i ritratti.

## Backfill dei volumi esistenti

Prima di applicare: backup del DB, anteprima degli ID e degli effetti. Il comando è in sola lettura per default e **non chiama la rete** senza `--live`.

```sh
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test exec -T backend npm run eventi:immagini -- --limite=20
```

Usa prima `snapshot.images` se esiste. Gli snapshot precedenti che hanno scartato l'array richiedono il dettaglio Ticketmaster, solo per ID di eventi già importati. Dopo il backup:

```sh
docker compose --env-file .env.test -f docker-compose.test.yml -p waveset-test exec -T backend npm run eventi:immagini -- --live --applica --limite=20
```

Opzionale: `--eventi=269,270` limita ulteriormente il lotto. `--limite` deve essere 1–100 (default20). Pacing350ms, massimo un retry per richiesta e budget massimo doppio del lotto; chiave solo backend. In sviluppo usare lo stesso comando nel Compose principale, con `.env` e `docker-compose.yml`, dopo aver ricostruito backend e worker. Non avviare seed sui volumi esistenti.

Il backfill acquisisce lo stesso lock MySQL del worker. Applica esclusivamente:

```sql
UPDATE ticketmaster_evento_fonte
SET snapshot = JSON_SET(snapshot, '$.images', CAST(? AS JSON), '$.immagine', CAST(? AS JSON))
WHERE evento_id = ? AND NOT JSON_CONTAINS_PATH(snapshot, 'one', '$.immagine');
```

Tutti gli altri campi dello snapshot e della riga fonte sono conservati. Nessuna scrittura su `evento`, `evento_artista`, artisti, utenti, sessioni o follow. La presenza di `immagine`, anche `null`, rende il comando idempotente; retry successivi non consumano richieste per eventi già elaborati. Una futura sync valida può aggiornare la copertina. 404/ID inatteso/errore remoto non scrivono e lasciano il candidato ripetibile. Il comando segnala tramite exit code non-zero errori, eventi non disponibili, fonte da recuperare o lock occupato.

## Test

- `ticketmasterImmaginiSenzaDb.test.js`: selezione, URL/dimensioni invalidi, fallback, separazione lineup, backfill e lock; nessuna chiamata reale.
- `followSenzaDb.test.js`: API pubbliche lista/dettaglio con copertina e senza; foto artista indipendente.
- `ticketmasterImmaginiPersistenza.test.js`: JSON MySQL, backfill idempotente, conservazione dei campi ADMIN e aggiornamento nelle sync successive; fixture pulite, fonte simulata.
- Frontend: normalizzazione retrocompatibile, ritratto nel hero, cover lista/dettaglio presente/assente/errore e foto lineup conservata.
