-- Follow utente -> artista: join N:N implicito, senza attributi (CLAUDE.md,
-- "Modello dati"). La chiave primaria composta impedisce di seguire due volte
-- lo stesso artista; le cascate eliminano i follow quando sparisce l'utente o
-- l'artista.
CREATE TABLE utente_artista (
    utente_id INT NOT NULL,
    artista_id INT NOT NULL,
    PRIMARY KEY (utente_id, artista_id),
    FOREIGN KEY (utente_id) REFERENCES utente(id) ON DELETE CASCADE,
    FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
