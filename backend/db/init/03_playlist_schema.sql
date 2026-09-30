-- password_hash è un hash bcrypt (formato "$2b$12$...", 60 caratteri): la
-- password in chiaro non viene mai salvata. Le sessioni sono in
-- 07_sessioni_schema.sql.
CREATE TABLE utente (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash CHAR(60) NOT NULL,
    ruolo ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE playlist (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    utente_id INT NOT NULL,
    FOREIGN KEY (utente_id) REFERENCES utente(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE playlist_brano (
    playlist_id INT NOT NULL,
    brano_id INT NOT NULL,
    aggiunto_il TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, brano_id),
    FOREIGN KEY (playlist_id) REFERENCES playlist(id) ON DELETE CASCADE,
    FOREIGN KEY (brano_id) REFERENCES brano(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
