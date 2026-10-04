-- Seed opzionale: 33 artisti elettronici reali, solo nome.
-- Prerequisito: tabella artista creata dallo schema; nessun altro seed richiesto.
-- Eseguito automaticamente con gli altri init su un volume MySQL nuovo.
-- Idempotente e sicuro in sequenza su tabelle vuote o DB esistenti:
-- inserisce solo i nomi mancanti, senza modificare gli artisti presenti.
-- Il confronto segue la collation di artista.nome; nessun vincolo UNIQUE aggiunto.
-- Non eseguire in parallelo: lo schema non garantisce unicita sul nome.
-- Bio e immagine omesse: restano NULL per le nuove righe.

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Martin Garrix' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Alesso' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Fred again' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'BUNT.' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'ILLENIUM' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'FISHER' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Kaskade' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Matisse & Sadko' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Hardwell' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Steve Aoki' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Charlotte de Witte' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Amelie Lens' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Adam Beyer' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Nina Kraviz' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Armin van Buuren' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Black Coffee' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Peggy Gou' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Chris Lake' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'John Summit' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'David Guetta' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Above & Beyond' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Paul van Dyk' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Aly & Fila' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Gareth Emery' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Pendulum' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Andy C' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Wilkinson' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Metrik' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Tale Of Us' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Maceo Plex' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Stephan Bodzin' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Tiësto' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;

INSERT INTO artista (nome)
SELECT candidato.nome FROM (SELECT 'Sub Focus' AS nome) AS candidato
LEFT JOIN artista AS esistente ON esistente.nome = candidato.nome
WHERE esistente.id IS NULL;
