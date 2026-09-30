-- Evento minimale: serve alla sezione "Prossimi eventi" di Dettaglio artista.
-- Lo step "Eventi + mappa" lo estenderà (revisione Ticketmaster, ecc.) invece
-- di sostituirlo. latitudine/longitudine sono già nel modello dati
-- (CLAUDE.md) anche se oggi nessuna schermata le usa.
--
-- data_evento è DATE e ora_evento è TIME, separati e senza fuso, di proposito:
-- sono sempre "la data e l'ora locali del locale". Un DATETIME/TIMESTAMP
-- verrebbe serializzato in JSON come istante UTC e il device lo mostrerebbe
-- spostato in base al suo fuso; DATE e TIME restano stringhe (mysql2 le
-- restituisce così, "21:30:00") e non vengono mai convertite.
-- ora_evento è NULL quando l'orario non è noto (es. evento inserito a mano
-- o import Ticketmaster senza localTime).
CREATE TABLE evento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    titolo VARCHAR(200) NOT NULL,
    data_evento DATE NOT NULL,
    ora_evento TIME NULL,
    luogo VARCHAR(200),
    citta VARCHAR(100),
    latitudine DECIMAL(9,6),
    longitudine DECIMAL(9,6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lineup: N:N pura, nessun campo "ruolo" in v1 (CLAUDE.md).
CREATE TABLE evento_artista (
    evento_id INT NOT NULL,
    artista_id INT NOT NULL,
    PRIMARY KEY (evento_id, artista_id),
    FOREIGN KEY (evento_id) REFERENCES evento(id) ON DELETE CASCADE,
    FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
