-- Solo stato informativo, separato dalle identità Ticketmaster confermate ADMIN.
CREATE TABLE IF NOT EXISTS artista_ticketmaster_presenza (
    link_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    external_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    storefront CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    esito_json JSON NOT NULL,
    controllato_at DATETIME(3) NOT NULL,
    CONSTRAINT fk_presenza_provider FOREIGN KEY (link_id)
        REFERENCES artista_provider_link(id) ON DELETE CASCADE
) ENGINE=InnoDB;
