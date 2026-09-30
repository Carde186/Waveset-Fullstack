-- Schema del catalogo (Genere, Artista, Album, Brano).
-- User/Playlist/Review/Event arrivano negli step successivi.

CREATE TABLE genere (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE artista (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    bio TEXT,
    immagine_url VARCHAR(500)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE artista_genere (
    artista_id INT NOT NULL,
    genere_id INT NOT NULL,
    PRIMARY KEY (artista_id, genere_id),
    FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE CASCADE,
    FOREIGN KEY (genere_id) REFERENCES genere(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE album (
    id INT AUTO_INCREMENT PRIMARY KEY,
    titolo VARCHAR(200) NOT NULL,
    data_pubblicazione DATE,
    artista_id INT NOT NULL,
    copertina_url VARCHAR(500),
    FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE brano (
    id INT AUTO_INCREMENT PRIMARY KEY,
    titolo VARCHAR(200) NOT NULL,
    artista_id INT NOT NULL,
    album_id INT,
    data_pubblicazione DATE,
    url_spotify VARCHAR(500),
    FOREIGN KEY (artista_id) REFERENCES artista(id) ON DELETE CASCADE,
    FOREIGN KEY (album_id) REFERENCES album(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
