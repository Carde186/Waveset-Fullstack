// Contratti delle route reali; dati dimostrativi, mai letture del DB.
export const GENERI = [
    { id: 1, nome: 'Techno' },
    { id: 2, nome: 'House' },
];
export const ARTISTI = [
    { id: 1, nome: 'Nova Circuit', immagine_url: 'https://picsum.photos/seed/nova/400' },
];
export const BRANO = {
    id: 11,
    titolo: 'Voltaggio',
    dataPubblicazione: '2022-06-10T00:00:00.000Z',
    urlSpotify: null,
    collaboratori: null,
    artista: { id: 1, nome: 'Nova Circuit', immagineUrl: null },
    album: {
        id: 21,
        titolo: 'Circuiti Notturni',
        copertinaUrl: 'https://picsum.photos/seed/circuiti/400',
    },
};
export const BRANO_SQL = {
    id: 11,
    titolo: 'Voltaggio',
    data_pubblicazione: '2022-06-10T00:00:00.000Z',
    url_spotify: null,
};
export const ALBUM = {
    id: 21,
    titolo: 'Circuiti Notturni',
    dataPubblicazione: '2022-06-10T00:00:00.000Z',
    copertinaUrl: 'https://picsum.photos/seed/circuiti/400',
    artista: { id: 1, nome: 'Nova Circuit', immagineUrl: null },
    brani: [BRANO_SQL],
};
export const ARTISTA = {
    ...ARTISTI[0],
    id: 1,
    nome: 'Nova Circuit',
    bio: 'Suoni dalla scena dei club.',
    credito_immagine: null,
    generi: [GENERI[0]],
    seguito: false,
    brani: [{ ...BRANO_SQL, album_id: 21 }],
    album: [
        {
            id: 21,
            titolo: 'Circuiti Notturni',
            data_pubblicazione: '2022-06-10',
            copertina_url: null,
        },
    ],
    eventi: [
        {
            id: 101,
            titolo: 'Circuiti Live',
            data_evento: '2027-02-13',
            ora_evento: null,
            luogo: null,
            citta: null,
        },
    ],
};
