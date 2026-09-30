-- Sessioni lato server (niente JWT, vedi CLAUDE.md "Autenticazione").
--
-- hash_token: SHA-256 in esadecimale del token consegnato al client. Il token
-- in chiaro non viene mai salvato: chi legge questa tabella non può usarlo.
--
-- device_id UNIQUE = una sola sessione per dispositivo. È anche la chiave con
-- cui il middleware trova la riga (non è un segreto): il confronto del
-- segreto avviene poi in Node con crypto.timingSafeEqual sull'hash, invece che
-- in MySQL con un "=" che non è a tempo costante.
--
-- scadenza viene calcolata e confrontata sempre con NOW() di MySQL, mai con
-- l'orologio del device o di Node, così non entrano in gioco i fusi orari.
CREATE TABLE sessioni (
    id INT AUTO_INCREMENT PRIMARY KEY,
    utente_id INT NOT NULL,
    hash_token CHAR(64) NOT NULL,
    device_id VARCHAR(36) NOT NULL UNIQUE,
    scadenza DATETIME NOT NULL,
    creata_il TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (utente_id) REFERENCES utente(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
