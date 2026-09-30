-- Fixture minime per linkEsterniLotto1.test.js e itunesCopertina.test.js: le
-- route confrontano solo nome artista, titolo album e titolo brano.
SET @guardia = IF(DATABASE() <=> 'waveset_test',
    'DO 0',
    'SELECT * FROM `__seed_test_db_errato__`');
PREPARE g FROM @guardia;
EXECUTE g;
DEALLOCATE PREPARE g;

INSERT INTO artista (nome)
SELECT v.nome
FROM (SELECT 'Carl Cox' AS nome UNION ALL SELECT 'Charlotte de Witte') AS v
WHERE DATABASE() <=> 'waveset_test'
  AND NOT EXISTS (SELECT 1 FROM artista a WHERE a.nome = v.nome);

INSERT INTO album (titolo, artista_id)
SELECT v.titolo, a.id
FROM (
    SELECT 'Carl Cox' AS artista, 'All Roads Lead to the Dancefloor' AS titolo
    UNION ALL SELECT 'Charlotte de Witte', 'Charlotte de Witte'
) AS v
INNER JOIN artista a ON a.nome = v.artista
WHERE DATABASE() <=> 'waveset_test'
  AND NOT EXISTS (
      SELECT 1 FROM album al WHERE al.artista_id = a.id AND al.titolo = v.titolo
  );

INSERT INTO brano (titolo, artista_id, album_id)
SELECT v.brano, a.id, al.id
FROM (
    SELECT 'Carl Cox' AS artista, 'All Roads Lead to the Dancefloor' AS album,
           'Short Black' AS brano
    UNION ALL SELECT 'Carl Cox', 'All Roads Lead to the Dancefloor', 'Bread & Butter'
    UNION ALL SELECT 'Charlotte de Witte', 'Charlotte de Witte', 'The Realm'
) AS v
INNER JOIN artista a ON a.nome = v.artista
INNER JOIN album al ON al.artista_id = a.id AND al.titolo = v.album
WHERE DATABASE() <=> 'waveset_test'
  AND NOT EXISTS (
      SELECT 1 FROM brano b WHERE b.artista_id = a.id AND b.titolo = v.brano
  );
