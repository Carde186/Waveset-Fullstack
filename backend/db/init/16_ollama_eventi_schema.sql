-- Aggiunta idempotente: la procedura salta ALTER se l'enum è già aggiornato.
ALTER TABLE evento MODIFY stato ENUM('pubblicato','in_coda','scartato','da_valutare') NOT NULL DEFAULT 'pubblicato';
CREATE TABLE IF NOT EXISTS ollama_evento_job (
    evento_id INT NOT NULL PRIMARY KEY,
    generazione INT UNSIGNED NOT NULL DEFAULT 1,
    stato ENUM('da_valutare','approva','rifiuta') NOT NULL DEFAULT 'da_valutare',
    input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    tentativi INT UNSIGNED NOT NULL DEFAULT 0,
    prossimo_tentativo DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    motivazione VARCHAR(400) NULL,
    errore VARCHAR(100) NULL,
    valutato_at DATETIME(3) NULL,
    stato_precedente VARCHAR(32) NULL,
    motivo_precedente VARCHAR(255) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_ollama_pronti (stato,prossimo_tentativo),
    CONSTRAINT fk_ollama_job_evento FOREIGN KEY (evento_id) REFERENCES evento(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ollama_evento_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    evento_id INT NOT NULL,
    artista_id INT NULL,
    generazione INT UNSIGNED NOT NULL,
    tentativo INT UNSIGNED NOT NULL,
    modello VARCHAR(100) NOT NULL,
    versione_prompt VARCHAR(64) NOT NULL,
    input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    input_json JSON NOT NULL,
    risposta_raw TEXT NULL,
    decisione_modello ENUM('approva','rifiuta') NULL,
    confidenza DECIMAL(6,5) NULL,
    motivazione VARCHAR(400) NULL,
    errore VARCHAR(100) NULL,
    decisione_applicata ENUM('approva','rifiuta','da_valutare') NOT NULL DEFAULT 'da_valutare',
    iniziato_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    completato_at DATETIME(3) NULL,
    UNIQUE KEY uq_ollama_tentativo (evento_id,artista_id,generazione,tentativo),
    INDEX idx_ollama_audit_evento (evento_id,id),
    CONSTRAINT fk_ollama_audit_evento FOREIGN KEY (evento_id) REFERENCES evento(id) ON DELETE CASCADE,
    CONSTRAINT fk_ollama_audit_artista FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE SET NULL
) ENGINE=InnoDB;
-- Ogni Ticketmaster esistente riparte dal controllo automatico UNA SOLA volta.
-- Stato/motivo precedenti conservati; dati curati, immagini e snapshot intatti.
INSERT IGNORE INTO ollama_evento_job (evento_id,stato_precedente,motivo_precedente)
SELECT id,stato,motivo_revisione FROM evento WHERE fonte='ticketmaster';
UPDATE evento e JOIN ollama_evento_job j ON j.evento_id=e.id
SET e.stato='da_valutare' WHERE j.stato='da_valutare' AND e.fonte='ticketmaster';

UPDATE ticketmaster_evento_fonte sf JOIN ollama_evento_job j ON j.evento_id=sf.evento_id
SET sf.campi_applicati=JSON_SET(sf.campi_applicati,'$.stato','da_valutare')
WHERE j.stato='da_valutare' AND sf.protetto_admin=FALSE AND sf.campi_applicati IS NOT NULL;
