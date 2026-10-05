# Catalogo pubblico, discografia e immagini

Per collegare i profili consulta la [guida Deezer](provider-artisti.md); per avvio e test il [README](../README.md). Le API pubbliche escludono i quattro artisti demo e i contenuti associati, mantenendo i record nel DB e nella gestione ADMIN. Gli artisti reali restano visibili anche senza Deezer.

## Generi e filtri

`backend/src/catalogo/classificazione.json` assegna categorie editoriali ai 33 artisti del seed e a Carl Cox. Sono filtri locali, distinti dai generi eventualmente forniti da Deezer; un artista può avere più categorie.

Dalla root, salva un backup del DB esistente e applica solo le associazioni mancanti:

```bash
docker compose exec -T backend npm run catalogo:classifica
docker compose exec -T backend npm run catalogo:classifica -- --applica
```

Ripeti l'anteprima: `nuoveAssociazioni` deve essere zero. Il comando usa una transazione e non sostituisce associazioni esistenti. Serve anche dopo l'init di un nuovo volume, perché il seed contiene solo i nomi.

`GET /api/eventi?filtro=tutti&genere_id=1` filtra per qualunque artista della lineup. Il filtro USER `filtro=seguiti` si combina con il genere; entrambi i criteri devono essere soddisfatti. Lista e marker condividono risultati senza duplicati, conservando i filtri nella navigazione. Ospiti e ADMIN non dispongono del follow.

## Artisti seguiti

`GET /api/artisti/seguiti` restituisce gli artisti dell'utente in ordine alfabetico con ID, nome e immagine. Richiede sessione USER: ospiti 401, ADMIN 403; risposte `Cache-Control: no-store`.

Da `/artisti-seguiti` puoi aprire il profilo o rimuovere il follow con CSRF; errori conservano la card. Login e registrazione dal profilo riportano all'artista senza seguirlo automaticamente.

## Biografie e fan

La biografia curata in `artista.bio` ha precedenza sui testi editoriali IT/EN in `backend/src/catalogo/biografie.json`, che includono le fonti. In assenza di entrambi viene mostrato uno stato vuoto.

`GET /api/artisti/:id` espone `biografia` (`it`, `en`, `fonteUrl`) e `popolarita_deezer` (`fan`, `url`, `aggiornato_at`), oppure null. I fan riflettono l'ultima sync ADMIN: non sono ascolti o ascoltatori mensili e un valore assente non diventa zero.

## Discografia Deezer

`GET /api/artisti/:id/discografia?indice=0` usa soltanto il profilo confermato. Senza link restituisce `disponibile: false`; con link legge i 10 brani popolari e 12 pubblicazioni per pagina. L'indice è multiplo di 12; album, singoli ed EP mantengono il tipo della fonte.

URL e paginazione sono validati, con cache RAM di cinque minuti. La risposta espone metadati, copertine, link Deezer e `prossimoIndice`; non salva album o brani nel DB. Il frontend deduplica le pagine; restano i link Spotify già verificati.

## Immagini e copertine

| Contenuto | Fonte e alternativa |
| --- | --- |
| Ritratto artista e foto lineup | Deezer (`picture_medium` preferita), poi foto locale, poi segnaposto. |
| Marker Maps | Foto del primo artista della lineup, con iniziale se manca o non carica. |
| Album e brani Deezer | Copertina della pubblicazione, con segnaposto musicale. |
| Evento | Solo `images` dell'evento Ticketmaster, con segnaposto evento. |

Le API espongono `immagine_url` e `immagine_provider` per gli artisti. I crediti riguardano solo le foto locali; i ritratti usano i profili salvati.

`backend/src/ticketmaster/immagini.js` valida URL dei CDN Ticketmaster e dimensioni. Preferisce immagini non-fallback, rapporti 16:9 o 3:2 e la minima larghezza di almeno 1024 px; sotto soglia sceglie la più larga. Rapporto, altezza e URL risolvono le parità senza dipendere dall'ordine della fonte.

`ticketmaster_evento_fonte.snapshot` conserva candidati e copertina scelta. Le API espongono `immagine_url` e `immagine` (dimensioni, rapporto, fallback e fonte). Errori conservano la copertina precedente; una risposta valida senza immagini produce null. `CopertinaEvento` è condiviso da lista e dettaglio.

## Recupero immagini degli eventi esistenti

Dalla root, esegui prima l'anteprima, che non scrive e non chiama la rete:

```bash
docker compose exec -T backend npm run eventi:immagini -- --limite=20
```

Usa le immagini già presenti nello snapshot. Se mancano, dopo il backup puoi abilitare il recupero Ticketmaster e l'applicazione:

```bash
docker compose exec -T backend npm run eventi:immagini -- --live --applica --limite=20
```

`--eventi=ID1,ID2` seleziona gli ID del tuo DB; `--limite` accetta 1–100. Il comando usa il lock della sync e aggiunge solo i campi immagine mancanti, conservando gli altri dati. È idempotente anche con copertina null. Errori e lock occupato richiedono un nuovo tentativo.

Per provarlo sul DB isolato, usa `docker compose --env-file .env.test -f docker-compose.test.yml exec -T backend` al posto del prefisso Compose principale. I test di immagini, follow e discografia usano fonti simulate.

## Esplora e pubblicazione eventi

Esplora mostra artisti e prossimi eventi. `GET /api/catalogo/copertine` alimenta i hero con artwork salvati di album ed eventi. I dettagli mantengono ritratto o copertina specifici.

Gli eventi Ticketmaster pubblici devono essere approvati dal worker e rispettare data e stato della fonte. Regole, tentativi e registro ADMIN nella [guida Ollama](ollama-eventi.md).
