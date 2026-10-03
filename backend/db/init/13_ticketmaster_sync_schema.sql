-- Additivo e ripetibile sui volumi esistenti. Nessuna modifica al catalogo.
CREATE TABLE IF NOT EXISTS ticketmaster_evento_fonte (
    evento_id INT NOT NULL PRIMARY KEY,
    snapshot JSON NOT NULL,
    campi_applicati JSON NULL,
    lineup_applicata JSON NULL,
    protetto_admin BOOLEAN NOT NULL DEFAULT TRUE,
    stato_fonte ENUM('onsale','offsale','canceled','postponed','rescheduled','unknown') NOT NULL DEFAULT 'unknown',
    ultimo_controllo DATETIME(3) NOT NULL,
    ultimo_avvistamento DATETIME(3) NULL,
    assente_dal DATETIME(3) NULL,
    modifiche_fonte BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (evento_id) REFERENCES evento(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticketmaster_artista_sync (
    artista_id INT NOT NULL PRIMARY KEY,
    ultimo_tentativo DATETIME(3) NULL,
    ultimo_successo DATETIME(3) NULL,
    prossimo_tentativo DATETIME(3) NULL,
    fallimenti INT NOT NULL DEFAULT 0,
    errore VARCHAR(40) NULL,
    FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ticketmaster_sync_stato (
    id TINYINT NOT NULL PRIMARY KEY,
    ultimo_tentativo DATETIME(3) NULL,
    ultimo_successo DATETIME(3) NULL,
    errore VARCHAR(40) NULL,
    richieste INT NOT NULL DEFAULT 0,
    prossimo_tentativo DATETIME(3) NULL,
    fallimenti INT NOT NULL DEFAULT 0,
    esito ENUM('ok','parziale','errore') NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
