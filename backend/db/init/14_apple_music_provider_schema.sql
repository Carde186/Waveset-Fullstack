-- Metadati dei provider separati dai dati locali e dalle decisioni Ticketmaster.
-- Il collegamento corrente viene sostituito atomicamente dopo conferma ADMIN.
CREATE TABLE IF NOT EXISTS artista_provider_link (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    artista_id INT NOT NULL,
    provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    external_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    storefront CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    url VARCHAR(1000) NOT NULL,
    immagine_url VARCHAR(1000) NULL,
    dati_normalizzati_json JSON NOT NULL,
    raw_json JSON NOT NULL,
    sincronizzato_at DATETIME(3) NOT NULL,
    versione INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_provider_esterno (provider, external_id, storefront),
    UNIQUE KEY uq_artista_provider (artista_id, provider),
    CONSTRAINT fk_provider_artista FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE CASCADE
) ENGINE=InnoDB;
