-- Solo ambiente di test (docker-compose.test.yml). La guardia si ferma PRIMA
-- di ogni scrittura se il DB selezionato non è waveset_test: senza --force il
-- client mysql interrompe l'esecuzione al primo errore. Ogni INSERT ripete
-- comunque la condizione su DATABASE().
SET @guardia = IF(DATABASE() <=> 'waveset_test',
    'DO 0',
    'SELECT * FROM `__seed_test_db_errato__`');
PREPARE g FROM @guardia;
EXECUTE g;
DEALLOCATE PREPARE g;

INSERT INTO utente (nome, email, password_hash, ruolo)
SELECT v.nome, v.email, v.pw, v.ruolo
FROM (
    SELECT 'Test A' AS nome, 'test-a@waveset.test' AS email,
           '$2b$12$9Me89RyxB8DliibYEnIbpue274UmGUq6JCdvcB.exnp6kXCLcuvYO' AS pw,
           'USER' AS ruolo
    UNION ALL
    SELECT 'Test B', 'test-b@waveset.test',
           '$2b$12$VhOCZZtk4AHv.syhGOTj5eXS8C0ACuE/m7usztvXpveW41RbdSX5q', 'USER'
    UNION ALL
    SELECT 'Test Admin', 'test-admin@waveset.test',
           '$2b$12$xzzqS1nge5PtMKXG/AzISeM0bn.rYI2vYt1i3m8WntA2SPX6UoF1K', 'ADMIN'
) AS v
WHERE DATABASE() <=> 'waveset_test'
  AND NOT EXISTS (SELECT 1 FROM utente u WHERE u.email = v.email);

-- Test A segue Nova Circuit e Lucent Wave (novita.test.js, eventi.test.js).
INSERT IGNORE INTO utente_artista (utente_id, artista_id)
SELECT u.id, a.id
FROM utente u
INNER JOIN artista a ON a.nome IN ('Nova Circuit', 'Lucent Wave')
WHERE u.email = 'test-a@waveset.test' AND DATABASE() <=> 'waveset_test';
