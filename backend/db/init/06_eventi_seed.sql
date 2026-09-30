-- Eventi di prova TEMPORANEI (locali e titoli inventati), stessa logica del
-- seed del catalogo: verranno sostituiti dall'import Ticketmaster e
-- dall'inserimento manuale ADMIN, non estesi a mano. Date scelte lontane nel
-- futuro perché "Prossimi eventi" mostra solo data_evento >= oggi.
INSERT INTO evento (titolo, data_evento, ora_evento, luogo, citta, latitudine, longitudine) VALUES
    ('Circuiti Live', '2027-02-13', '22:00:00', 'Club Nord', 'Torino', 45.070300, 7.686900),
    ('Notte Elettrica', '2027-04-03', '23:30:00', 'Magazzini Est', 'Milano', 45.464200, 9.190000),
    ('Sunset Session', '2027-03-20', '19:00:00', 'Lido Azzurro', 'Napoli', 40.851800, 14.268100),
    ('Drum Night', '2027-05-08', NULL, 'Sala Sotterranea', 'Bologna', 44.494900, 11.342600);

-- Notte Elettrica ha due artisti in lineup (N:N).
INSERT INTO evento_artista (evento_id, artista_id) VALUES
    (1, 1),
    (2, 1),
    (2, 3),
    (3, 2),
    (4, 4);
