# CLAUDE.md — Waveset Fullstack Web

## Scopo

Questo documento guida **solo** il progetto Fullstack web Waveset in una nuova sessione di Claude Code. Non presumere accesso a chat precedenti. Prima di modificare file, ispeziona repository, README, codice, test, schema, seed e migrazioni: distingui stato reale, obiettivi e ipotesi.

Waveset è una piattaforma didattica di scoperta musicale elettronica. Gli ospiti esplorano musica ed eventi; gli utenti registrati seguono artisti e gestiscono playlist; un ADMIN gestisce catalogo, eventi e revisioni. Apple Music e Spotify sono destinazioni esterne, non un player integrato.

## Backend esistente e monorepo

Esiste già un backend Waveset in Node.js + Express + MySQL da riutilizzare come base. Se non è nel workspace, chiedi dove si trova: non inventare percorso, route, schema o stato del DB. Inventaria servizi, endpoint, test, seed, migrazioni e variabili d'ambiente prima di adattarlo.

Il nuovo repository Fullstack è un monorepo con servizi separati, per esempio `frontend/`, `backend/`, `docker-compose.yml`, `.env.example` e `README.md`. Mantieni la fonte di verità delle migrazioni dove si trova già salvo ragione per spostarla. Il progetto deve funzionare da `git clone` seguendo il README: i dati di un volume DB di sviluppo non vengono trasferiti automaticamente da Git.

La consegna richiede database, backend, API, frontend web, Docker Compose per i servizi necessari, funzione AI reale nel backend, README completo (uso, prerequisiti, servizi, dati di prova, funzionalità future, riferimenti), integrazioni esterne documentate e dati iniziali riproducibili.

Prima del codice, presenta una tabella «già presente / da adattare / da implementare / incerto». Registrazione, seed con solo ADMIN, frontend web, ricerca Apple live, aggiornamento automatico eventi, Ollama e flusso AI sono **obiettivi**, non cose già implementate.

## Direzione grafica

Identità approvata: **Club**. Base quasi nera, verde profondo e lime visibile anche in card, sfumature e parti degli sfondi; alterna superfici scure e zone luminose. Titoli grandi e decisi, layout desktop responsive, navigazione orizzontale. Non realizzare una landing generica o un clone di Spotify. Niente Lorem Picsum, ritratti inventati spacciati per foto reali o URL di streaming fittizi. Distingui foto profilo degli artisti da artwork di album/brani.

Esplora include ricerca, filtri e sezioni per artisti/brani in tendenza; gli artisti **locali** devono essere distinguibili dai risultati **Apple live**. Dettagli artista/album/brano mostrano solo azioni realmente disponibili. Eventi mostra mappa ed elenco affiancati quando lo spazio lo consente; Playlist è personale. L'AI si trova nel flusso di revisione ADMIN, non in consigli musicali inventati sulla Home.

NativeWind non è richiesto. Scegli e motiva una soluzione CSS adatta al web. Se le preview approvate non sono nella nuova sessione, chiedile prima di riprodurne i dettagli.

## Registrazione e account

Su un ambiente inizializzato da zero non devono esistere account USER predefiniti. L'unico account predisposto è **un ADMIN**. Un nuovo utente si registra autonomamente come `USER`; il ruolo viene deciso dal server e il client non può autoassegnarsi ADMIN.

Email validata e univoca, password hashata con algoritmo adeguato, niente password/token in chiaro nei log. Riutilizza login/logout e sessioni del backend se presenti. Per il browser scegli consapevolmente cookie HttpOnly con protezione CSRF per mutazioni oppure bearer token con strategia di memorizzazione e rischi documentati. Crea l'ADMIN con procedura idempotente e credenziali configurate localmente, non una password fissa pubblica versionata.

Rimuovi gli USER predefiniti dai **seed versionati**; non cancellare account, playlist, follow o sessioni nel DB di sviluppo senza anteprima e conferma. Testa registrazione, duplicati, divieto di autoassegnarsi ADMIN, login/logout, route ADMIN e isolamento dei dati fra utenti.

## Catalogo dinamico: due livelli

**Non limitare Esplora ai pochi artisti salvati nel DB locale.** Il nuovo frontend web deve offrire più musica tramite la ricerca pubblica Apple, mantenendo chiaro cosa è una scoperta esterna e cosa fa parte del catalogo persistente Waveset.

### Esplora Apple live

- Usa la **iTunes Search API pubblica** per cercare artisti, album e brani nello store pertinente (Italia di default); non confonderla con altre API Apple Music che richiedono credenziali diverse.
- Il backend media le chiamate e valida query, paese, limiti e risultati. Aggiungi debounce nel frontend, cache con durata ragionevole e gestione controllata di timeout, errori e limiti Apple. Non interrogare Apple a ogni tasto digitato o a ogni render.
- Mostra i risultati Apple come **esterni**, con identità Apple quando disponibile. La copertina di un brano/album non è una foto profilo dell'artista. Verifica le condizioni applicabili prima di riutilizzare immagini o memorizzare metadati.
- Un risultato live NON è automaticamente un artista del DB Waveset, non ottiene automaticamente follow, playlist, recensioni o eventi collegati, e non deve essere descritto come pagina completa del catalogo locale.
- Per supportare un'azione persistente (per esempio seguire l'artista), progetta una **promozione controllata** del candidato nel catalogo locale: lookup per ID Apple stabile se utilizzabile, verifica identità, deduplica e inserimento minimo coerente con lo schema. Nei casi incerti richiedi revisione ADMIN. Non importare in massa l'intero feed o il primo risultato testuale; non creare duplicati.
- Documenta nel README cosa funziona con la sola ricerca live e cosa richiede inserimento locale. Se non riesci a implementare la promozione completa in questa consegna, rendi l'azione non disponibile e segnala esplicitamente il limite: non simulare un follow che non viene salvato.

### Tendenze Apple (opzionali ma reali se mostrate)

Puoi usare un feed RSS Apple delle classifiche per una sezione «In tendenza» distinta dal catalogo locale. Non promettere che il feed specifico si aggiorni a una frequenza garantita: registra `controllato_il` e, se possibile, `cambiato_il`. Interroga il feed a intervalli ragionevoli (come obiettivo iniziale, 12–24 ore, da verificare), memorizza temporaneamente solo quanto consentito e non farlo dipendere da un'importazione manuale. Le classifiche **brani** portano artwork di pubblicazioni, non foto profilo degli artisti. La categoria Dance non coincide automaticamente con Techno/EDM/House: usa soltanto filtri/ID di genere verificati e non inventare un filtro inesistente.

## Eventi dinamici: Ticketmaster

Ticketmaster Discovery API resta la fonte automatica degli eventi e richiede una **chiave Ticketmaster**. L'import del backend originario potrebbe essere manuale: **non presumere che aggiorni già gli eventi da solo**. La nuova versione Fullstack deve avere un processo di sincronizzazione automatico e documentato.

- Sincronizza gli eventi dei **soli artisti locali** interessati, non di tutti i risultati Apple live: per quelli esterni prima occorre un'identità verificata. Conserva e riusa l'eventuale `attractionId` già confermato dall'ADMIN; gli omonimi restano in revisione.
- Scegli un intervallo configurabile (proposta iniziale: controllo periodico ogni 6–12 ore) e un controllo mirato quando i dati di un artista sono scaduti. Definisci limiti di chiamata, cache, backoff, paginazione e protezione da richieste contemporanee duplicate. Non lanciare una chiamata Ticketmaster per ogni visita di ogni utente.
- Documenta e testa **chi avvia lo scheduler** in Docker Compose, come parte/si riavvia e come si impediscono processi duplicati. Prevedi anche un comando di sincronizzazione manuale per sviluppo e recupero guasti. Se il backend gira con più repliche, garantisci un solo esecutore con un meccanismo adeguato.
- Cerca solo eventi pertinenti e futuri quando possibile; in UI filtra gli eventi passati. Associa per `id_esterno` e gestisci nuove date, cambi data/luogo, annullamenti e indisponibilità della fonte con una strategia esplicita. **Non sovrascrivere** correzioni, approvazioni, scarti o collegamenti confermati dall'ADMIN con la sincronizzazione automatica: separa campi della fonte e campi curati dall'ADMIN o proteggi gli aggiornamenti.
- Per un risultato già presente aggiorna `ultimo_controllo` e, dove necessario, lo stato della fonte; evita duplicati. Definisci che cosa fare se un evento non compare più nella risposta: un'assenza temporanea non prova una cancellazione.
- Se Ticketmaster non risponde, mostra gli ultimi dati disponibili con indicazione dell'ultimo aggiornamento e un avviso se sono vecchi; non chiamarli «in tempo reale» né inventare eventi. La disponibilità di concerti dipende anche dalla copertura Ticketmaster: nessuna fonte garantisce tutti i concerti.
- Il calendario deve poter cambiare tra due visite separate da una settimana **senza interventi manuali**, quando la fonte pubblica eventi nuovi e la sincronizzazione riesce. Aggiungi test con orologio controllato per scadenza cache, idempotenza, dati modificati, fonte indisponibile, eventi passati e protezione delle correzioni ADMIN.

## Spotify: link opzionali, non Web API obbligatoria

La **Spotify Web API non è necessaria** per avviare e usare il nuovo Fullstack: non richiedere Spotify Client ID/Secret come prerequisito. Gli URL Spotify già verificati e presenti nel catalogo locale possono restare come link esterni. Se nel backend precedente esiste un'anteprima ADMIN che usa la Spotify Web API, inventariala e proponi se disabilitarla o tenerla come opzionale, senza rimuoverla alla cieca.

Per album e brani mostra Apple Music e Spotify insieme quando entrambi i link validi sono disponibili; non usare mai URL album come link al brano o viceversa. Un risultato Apple live non implica un link Spotify noto: non inventarlo e non fare scraping per fabbricarlo.

## Google Maps web: quattro modalità

Google Maps **resta richiesto** nella pagina Eventi tramite Maps JavaScript API; non sostituirlo con un'immagine o lista. Mappa interattiva, marker leggibili e collegati all'elenco, accesso al dettaglio; «Tutti» visibile agli ospiti, «Artisti che seguo» solo agli utenti autenticati.

Il selettore include **esattamente quattro modalità**: Standard (`roadmap`), Scura (`roadmap` con stile scuro supportato), Satellite (`satellite`) e Ibrida (`hybrid`). Scura non è un MapType nativo separato. Non simulare uno stile scuro invertendo le tile con CSS, perché altererebbe marker e immagini. Il cambio non deve perdere centro, zoom, filtri o evento selezionato. Salva la preferenza nel browser e ripristinala alla visita successiva; la scelta dell'utente prevale sul tema generale Club.

La chiave browser per Maps JavaScript API deve essere configurata per `localhost` e i domini previsti con restrizioni HTTP referrer e restrizione API; è visibile nel browser e va protetta con restrizioni, non chiamata «segreta». Se il backend usa Geocoding API, usa una **chiave server separata**, non esposta nel frontend. Documenta attivazione servizio e fatturazione secondo i requisiti attuali, senza promettere costi o quote fissi. Se manca Maps, mostra un messaggio esplicativo, non una mappa finta.

## AI locale: identità Apple ↔ Ticketmaster

La funzione AI reale del backend verifica se un artista del catalogo Apple e un'attraction collegata a un evento Ticketmaster sembrano riferirsi allo **stesso artista**. Apple e Ticketmaster descrivono dati diversi: non aspettarti tracklist, durata o ID condivisi. Un nome identico non prova l'identità.

1. Recupera record identificati e i riferimenti delle due fonti; non inviare token o segreti al modello.
2. Applica prima controlli deterministici: collegamenti già confermati dall'ADMIN, ID, nomi normalizzati con prudenza, alias e altri indizi realmente disponibili. Una discordanza forte non viene ignorata per seguire il modello.
3. Solo sui casi irrisolti chiama **Ollama locale** con un payload minimo e strutturato.
4. Valida l'output strutturato: `stesso_artista`, `artisti_diversi` o `incerto`, motivazione e indizi usati. L'AI non è una fonte indipendente di verità.
5. Mostra dati originali, fonti e proposta all'ADMIN. **Non collegare automaticamente un caso ambiguo** e non sovrascrivere conferme precedenti; l'ADMIN accetta o rifiuta, gli incerti restano in revisione. Registra la decisione confermata senza segreti o dati inutili.
6. Se Apple, Ticketmaster o Ollama non sono disponibili, gestisci l'errore e mantieni utilizzabili le altre funzioni.

Ollama non usa API key cloud. Non aggiungere OpenAI, Anthropic, OpenRouter o fallback cloud silenziosi. Configura URL e modello da env, scegli un modello locale sostenibile su laptop, documenta requisiti, scaricamento e collegamento al backend container, e non scaricare modelli grandi senza avvisare. **Restano necessarie le chiavi non-AI** per Ticketmaster e Google Maps.

## API, DB e sicurezza

Il frontend parla con il backend Waveset; fanno eccezione l'SDK browser di Maps e l'apertura intenzionale di link esterni. Non esporre secret server al browser. Mantieni la semantica già verificata di catalogo, sessioni, ruoli, follow, playlist, eventi e scritture ADMIN. Valida gli input. Un brano può avere `album_id` nullo; rappresenta i featuring senza inventare titoli ufficiali. Non assumere che tutti i lotti reali siano già nel DB che userai.

Prima di eliminare dati demo, verifica le dipendenze e gli effetti a cascata su playlist, follow ed eventi. Lo stato di un volume MySQL locale non è automaticamente ricostruibile dai file Git.

## Docker Compose e avvio da clone

Il monorepo deve avviare frontend, backend e MySQL con Compose. Ollama può essere nel Compose oppure sull'host purché sia raggiungibile e documentato. La sincronizzazione Ticketmaster deve partire nel setup definitivo con un solo esecutore; in sviluppo va disponibile un comando manuale. Documenta URL/porte, env, health check, ordine di schema/seed/migrazioni, inizializzazione unico ADMIN, modello Ollama e chiavi Maps/Ticketmaster.

Prova il percorso da ambiente pulito: clone, configurazione, avvio, login ADMIN, registrazione USER, ricerca Apple live, catalogo, playlist, mappa nei quattro layer, sincronizzazione eventi, revisione AI con Ollama. Dichiara quali passaggi non hai verificato.

## Test minimi

- Registrazione USER, email duplicata, tentativo ADMIN, login/logout e isolamento playlist.
- API catalogo locale e ricerca Apple live: debounce/cache/limiti, risultati vuoti, omonimi, deduplica e promozione controllata se implementata.
- Feed tendenze, se mostrato: parsing, filtro genere verificato, aggiornamento/cache e assenza di foto artista inventate.
- Scheduler Ticketmaster: intervallo, chiamate limitate, idempotenza, eventi futuri, modifiche e annullamenti, dati stantii, errori fonte e salvaguardia campi ADMIN.
- Ollama: stesso artista / diverso / incerto, output malformato e indisponibilità; nessun collegamento automatico ambiguo.
- Maps: quattro modalità, persistenza, marker e filtri, assenza chiave.
- Link corretti album/brano Apple/Spotify; Spotify Web API non necessaria.
- Suite, lint/build, avvio da clone pulito.

## Modalità di lavoro e README

Procedi per passi piccoli, spiegando le scelte tecniche. Prima di migrazioni o DELETE sul DB in uso: backup, anteprima esatta di righe ed effetti e conferma. Non fare `git add`, `git commit` o `git push` senza richiesta esplicita. Non versionare `.env`, credenziali, dump, backup, build o dati personali.

Il README è per un collega che parte da `git clone`: comandi esatti, prerequisiti, stack e ragioni delle scelte, variabili env, ADMIN locale e registrazione USER, seed, API Apple live e tendenze se presenti, Ticketmaster (chiave, scheduler e sincronizzazione manuale), Maps JS e quattro layer (chiave browser ristretta, eventuale Geocoding server), link Spotify opzionali, Ollama/modello, test, limiti, funzionalità future e riferimenti ufficiali. Distingui esplicitamente i dati locali persistenti dai risultati esterni live e dal DB di sviluppo. Non attribuire una frequenza di aggiornamento garantita al feed Apple se la fonte non la documenta.

## Checklist Fullstack

- [ ] Ispezionare e riutilizzare il backend esistente.
- [ ] Preparare monorepo e Compose riproducibili da clone.
- [ ] Rimuovere USER predefiniti dai seed e predisporre solo ADMIN locale.
- [ ] Implementare registrazione, sessioni e ruoli web.
- [ ] Realizzare frontend React responsive in stile Club.
- [ ] Aggiungere ricerca Apple live distinta dal catalogo locale e gestire il passaggio controllato al DB se necessario.
- [ ] Eventuale feed tendenze con frequenza osservata, non inventata.
- [ ] Automatizzare sincronizzazione Ticketmaster con cache, limiti, idempotenza e protezione correzioni ADMIN.
- [ ] Integrare Maps JS: Standard, Scura, Satellite, Ibrida; preferenza salvata.
- [ ] Integrare Ollama locale per i casi ambigui Apple–Ticketmaster e la revisione ADMIN.
- [ ] Rendere la Spotify Web API non necessaria; mantenere link validi già disponibili.
- [ ] Scrivere test/README e provare build e clone pulito.
