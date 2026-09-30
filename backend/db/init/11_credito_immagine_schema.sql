-- Credito per le foto artista con licenza libera (CC BY / CC BY-SA da
-- Wikimedia Commons — vedi CLAUDE.md, "Catalogo reale"): NULL per gli
-- artisti del seed dimostrativo (immagine_url punta a un placeholder
-- picsum.photos, nessuna licenza da citare). Popolato SOLO quando
-- immagine_url punta a una foto reale con licenza verificata — il frontend
-- mostra il credito (autore, licenza, fonte, eventuale modifica) solo se
-- immagine_autore non è NULL, mai per indovinare.
ALTER TABLE artista
    ADD COLUMN immagine_autore VARCHAR(200),
    ADD COLUMN immagine_licenza VARCHAR(100),
    ADD COLUMN immagine_fonte_url VARCHAR(500),
    ADD COLUMN immagine_modificata BOOLEAN NOT NULL DEFAULT FALSE;
