-- Dati di prova TEMPORANEI per sviluppare e testare le schermate di catalogo.
-- Un eventuale catalogo reale sostituirebbe questi dati, ma fonte e
-- strategia di import/conservazione non sono ancora decise (vedi
-- CLAUDE.md, "Integrazioni esterne") — non estendere questo seed a mano
-- nel frattempo.

INSERT INTO genere (nome) VALUES
    ('Techno'),
    ('House'),
    ('Trance'),
    ('Drum and Bass');

-- immagine_url/copertina_url: placeholder stabili (picsum.photos con seed
-- fisso per entità), solo per avere qualcosa da mostrare nei componenti
-- <Image> finché il catalogo reale (fonte e strategia ancora da decidere)
-- non li sostituisce.
INSERT INTO artista (nome, bio, immagine_url) VALUES
    ('Nova Circuit', 'Producer italiano di techno minimale, attivo dal 2015 nella scena dei club underground di Torino e Berlino.', 'https://picsum.photos/seed/nova-circuit/400/400'),
    ('Sunset Grid', 'Duo house da Napoli, noto per set melodici pensati per il tramonto.', 'https://picsum.photos/seed/sunset-grid/400/400'),
    ('Lucent Wave', 'Artista trance solista, radici a Milano, ispirato dalla scuola psy-trance goana.', 'https://picsum.photos/seed/lucent-wave/400/400'),
    ('Break Signal', 'Collettivo drum and bass di Bologna, fondato nel 2019.', 'https://picsum.photos/seed/break-signal/400/400');

INSERT INTO artista_genere (artista_id, genere_id) VALUES
    (1, 1),
    (2, 2),
    (3, 3),
    (4, 4),
    (1, 2);

INSERT INTO album (titolo, data_pubblicazione, artista_id, copertina_url) VALUES
    ('Circuiti Notturni', '2022-06-10', 1, 'https://picsum.photos/seed/circuiti-notturni/400/400'),
    ('Golden Hour', '2023-04-01', 2, 'https://picsum.photos/seed/golden-hour/400/400'),
    ('Frequenze Lucenti', '2021-09-15', 3, 'https://picsum.photos/seed/frequenze-lucenti/400/400');

-- url_spotify sempre NULL: erano id inventati (0000000000000000000001 e
-- successivi), mai stati veri track Spotify — rimossi per non rischiare di
-- mostrare un link rotto una volta aggiunto il bottone "Ascolta su
-- Spotify" a livello di dettaglio (vedi CLAUDE.md, "Catalogo reale").
INSERT INTO brano (titolo, artista_id, album_id, data_pubblicazione, url_spotify) VALUES
    ('Voltaggio', 1, 1, '2022-06-10', NULL),
    ('Rete Oscura', 1, 1, '2022-06-10', NULL),
    ('Alba su Napoli', 2, 2, '2023-04-01', NULL),
    ('Riflessi', 2, 2, '2023-04-01', NULL),
    ('Portale Lucente', 3, 3, '2021-09-15', NULL),
    ('Segnale Spezzato', 4, NULL, '2024-02-20', NULL);
