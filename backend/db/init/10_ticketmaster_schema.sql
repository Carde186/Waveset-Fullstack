-- Estende evento per l'importazione Ticketmaster (CLAUDE.md, "Integrazione
-- Ticketmaster"), invece di sostituire lo schema minimale di
-- 05_eventi_schema.sql.
--
-- fonte/id_esterno: distinguono un evento importato da uno inserito a mano
-- ed evitano reimportazioni (vedi backend/src/ticketmaster/importa.js:
-- se (fonte, id_esterno) esiste già, l'import non tocca quella riga, quale
-- che sia il suo stato — così un giro successivo non annulla mai una
-- correzione, un'approvazione o uno scarto già decisi dall'ADMIN).
--
-- stato/motivo_revisione: coda di revisione ibrida. 'scartato' non elimina
-- la riga (soft delete): serve a ricordare che l'ADMIN ha già deciso di non
-- pubblicare quell'evento, altrimenti un import successivo lo reinserirebbe.
ALTER TABLE evento
    ADD COLUMN fonte ENUM('manuale', 'ticketmaster') NOT NULL DEFAULT 'manuale',
    ADD COLUMN id_esterno VARCHAR(64) NULL,
    ADD COLUMN stato ENUM('pubblicato', 'in_coda', 'scartato') NOT NULL DEFAULT 'pubblicato',
    ADD COLUMN motivo_revisione VARCHAR(255) NULL,
    ADD UNIQUE KEY uq_evento_fonte_esterno (fonte, id_esterno);

-- Id della "attraction" Ticketmaster, impostato SOLO quando l'ADMIN conferma
-- esplicitamente il collegamento con questo artista (mai in automatico,
-- nemmeno approvando l'evento: vedi POST /api/admin/eventi/:id/artisti/:artistaId/conferma-collegamento).
-- Da quel momento le ricerche successive per questo artista usano
-- attractionId invece del nome, molto più precisa (nessun rischio di
-- omonimi).
ALTER TABLE artista
    ADD COLUMN id_ticketmaster VARCHAR(64) NULL UNIQUE;

-- Id della attraction candidata trovata per questo artista in questo
-- evento durante l'import, in attesa dell'eventuale conferma ADMIN di cui
-- sopra. NULL per il lineup inserito a mano.
ALTER TABLE evento_artista
    ADD COLUMN id_attraction_ticketmaster VARCHAR(64) NULL;
