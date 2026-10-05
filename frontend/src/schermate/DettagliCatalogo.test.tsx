import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router';
import { expect, test } from 'vitest';
import { App } from '../App';
import { ProviderAutenticazione } from '../autenticazione/ContestoAutenticazione';
import {
    differita,
    json,
    renderizzaApp,
    SESSIONE_NON_VALIDA,
    simulaBackend,
} from '../test/backend';
import { ALBUM, ARTISTA, ARTISTI, BRANO, GENERI } from '../test/catalogo';

function apri(percorso: string, rotte: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/artisti/1': json(200, ARTISTA),
        'GET /api/brani/11': json(200, BRANO),
        'GET /api/album/21': json(200, ALBUM),
        'GET /api/album/21/link-spotify': json(404, {}),
        'GET /api/generi': json(200, GENERI),
        'GET /api/artisti': json(200, ARTISTI),
        ...rotte,
    });
    renderizzaApp(percorso);
    return backend;
}
const titolo = (nome: string) => screen.findByRole('heading', { level: 1, name: nome });

test('navigazione reale artista → album → brano → artista → Esplora, solo GET locali', async () => {
    const backend = apri('/artisti/1');
    const utente = userEvent.setup();
    await titolo('Nova Circuit');
    expect(screen.getByText('Suoni dalla scena dei club.')).toBeInTheDocument();
    expect(screen.getByText('Orario non disponibile', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Circuiti Live/ })).toHaveAttribute('href', '/eventi/101');
    await utente.click(screen.getByRole('link', { name: 'Apri album Circuiti Notturni' }));
    await titolo('Circuiti Notturni');
    await utente.click(screen.getByRole('link', { name: /Voltaggio/ }));
    await titolo('Voltaggio');
    expect(screen.getByRole('link', { name: 'Apri album Circuiti Notturni' })).toHaveAttribute(
        'href',
        '/album/21',
    );
    await utente.click(screen.getByRole('link', { name: 'Nova Circuit' }));
    await titolo('Nova Circuit');
    await utente.click(
        within(screen.getByRole('navigation', { name: 'Percorso nel catalogo' })).getByRole(
            'link',
            { name: /Esplora/ },
        ),
    );
    await titolo('Esplora.');
    expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
    expect(backend.chiamate.some((c) => /copertina-itunes|segui|playlist/.test(c.percorso))).toBe(
        false,
    );
});

test('brano senza album, date e link nulli; featuring separato dal titolo', async () => {
    apri('/brani/11', {
        'GET /api/brani/11': json(200, {
            ...BRANO,
            album: null,
            dataPubblicazione: null,
            collaboratori: 'Ospite',
        }),
    });
    await titolo('Voltaggio');
    expect(screen.getByText('Collaborazioni: Ospite')).toBeInTheDocument();
    expect(screen.getByText('Data non disponibile')).toBeInTheDocument();
    expect(screen.getByText('Questo brano non è associato a un album.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Apri album/ })).not.toBeInTheDocument();
    await waitFor(() =>
        expect(screen.queryByText('Controllo il link Apple Music…')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: /Apri su/ })).not.toBeInTheDocument();
});

test('artista con campi nulli e liste vuote: stati veri, nessuna foto inventata o azione follow', async () => {
    apri('/artisti/1', {
        'GET /api/artisti/1': json(200, {
            ...ARTISTA,
            bio: null,
            immagine_url: null,
            generi: [],
            brani: [],
            album: [],
            eventi: [],
        }),
    });
    await titolo('Nova Circuit');
    for (const testo of [
        'Biografia non disponibile.',
        'Nessun album disponibile.',
        'Nessun brano disponibile.',
        'Nessun evento in arrivo.',
    ])
        expect(screen.getByText(testo)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Segui/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Foto:/)).not.toBeInTheDocument();
});

test('album vuoto e copertina demo: arte Club, artista collegato, giorno preservato senza fuso locale', async () => {
    apri('/album/21', { 'GET /api/album/21': json(200, { ...ALBUM, brani: [] }) });
    await titolo('Circuiti Notturni');
    expect(screen.getByText('10 giugno 2022')).toBeInTheDocument();
    expect(screen.getByText('Nessun brano disponibile.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nova Circuit' })).toHaveAttribute(
        'href',
        '/artisti/1',
    );
    expect(screen.getByText('Grafica Club')).toBeInTheDocument();
    expect(document.querySelector('img[src*="picsum"]')).toBeNull();
});

test.each([
    ['/artisti/1', '/api/artisti/1', 'Artista'],
    ['/brani/11', '/api/brani/11', 'Brano'],
    ['/album/21', '/api/album/21', 'Album'],
])('404 su %s con ritorno a Esplora', async (pagina, rotta, tipo) => {
    const backend = apri(pagina, { [`GET ${rotta}`]: json(404, { messaggio: 'Non trovato' }) });
    await titolo(`${tipo} non trovato.`);
    expect(screen.getByRole('link', { name: /Torna a Esplora/ })).toHaveAttribute(
        'href',
        '/esplora',
    );
    expect(screen.queryByRole('button', { name: /Riprova/ })).not.toBeInTheDocument();
    expect(backend.chiamate.some((c) => /link-apple|link-spotify/.test(c.percorso))).toBe(false);
});

test.each(['/artisti/abc', '/brani/0', '/album/9007199254740993'])(
    'ID invalido %s: 404 senza richiesta catalogo',
    async (pagina) => {
        const backend = apri(pagina);
        await screen.findByRole('heading', { level: 1, name: /non trovato/ });
        expect(backend.chiamate.filter((c) => c.percorso !== '/api/auth/io')).toHaveLength(0);
    },
);

test('caricamento, errore e riprova sullo stesso dettaglio', async () => {
    const risposta = differita<Response>();
    let n = 0;
    const backend = apri('/brani/11', {
        'GET /api/brani/11': () => (++n === 1 ? risposta.promessa : json(200, BRANO)),
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Carico il dettaglio…');
    await act(async () => risposta.risolvi(json(500, {})));
    const errore = await screen.findByRole('alert');
    expect(errore).toHaveTextContent('codice 500');
    await userEvent.setup().click(within(errore).getByRole('button', { name: /Riprova/ }));
    await titolo('Voltaggio');
    expect(backend.di('GET', '/api/brani/11')).toHaveLength(2);
});

test('risposta 200 incompleta è errore, non dettaglio vuoto o 404', async () => {
    apri('/album/21', { 'GET /api/album/21': json(200, {}) });
    expect(await screen.findByRole('alert')).toHaveTextContent(
        'I dati ricevuti non sono leggibili',
    );
    expect(screen.queryByText('Album non trovato.')).not.toBeInTheDocument();
});

test('brano con link Spotify salvato: nessun link o richiesta Apple Music', async () => {
    const backend = apri('/brani/11', {
        'GET /api/brani/11': json(200, { ...BRANO, urlSpotify: 'https://open.spotify.com/track/esempio' }),
    });
    await titolo('Voltaggio');
    expect(screen.getByRole('link', { name: 'Apri su Spotify ↗' })).toHaveAttribute('href', 'https://open.spotify.com/track/esempio');
    expect(screen.queryByRole('link', { name: /Apple Music/ })).not.toBeInTheDocument();
    expect(backend.chiamate.some(c => /link-apple|apple-music/.test(c.percorso))).toBe(false);
});

test('guasto di un link opzionale non nasconde il dettaglio; riprova senza ricaricare il brano', async () => {
    let n = 0;
    const backend = apri('/album/21', {
        'GET /api/album/21/link-spotify': () =>
            ++n === 1
                ? json(500, {})
                : json(200, { link_store: 'https://open.spotify.com/album/esempio' }),
    });
    await titolo(ALBUM.titolo);
    expect(await screen.findByRole('alert')).toHaveTextContent(
        'Il link Spotify non è disponibile',
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova link Spotify' }));
    expect(await screen.findByRole('link', { name: 'Apri su Spotify ↗' })).toBeInTheDocument();
    expect(backend.di('GET', '/api/album/21')).toHaveLength(1);
});

test('link Spotify album: quello restituito dalla mappatura', async () => {
    apri('/album/21', {
        'GET /api/album/21/link-spotify': json(200, {
            link_store: 'https://open.spotify.com/album/esempio',
        }),
    });
    expect(await screen.findByRole('link', { name: 'Apri su Spotify ↗' })).toHaveAttribute(
        'href',
        'https://open.spotify.com/album/esempio',
    );
});

test('foto artista con crediti; URL non sicuri non diventano link attivi', async () => {
    apri('/artisti/1', {
        'GET /api/artisti/1': json(200, {
            ...ARTISTA,
            immagine_url: 'https://example.org/foto.jpg',
            credito_immagine: {
                autore: 'Autore di prova',
                licenza: 'CC BY',
                fonte_url: 'javascript:alert(1)',
                modificata: true,
            },
        }),
    });
    expect(await screen.findByRole('img', { name: 'Foto di Nova Circuit' })).toHaveAttribute(
        'src',
        'https://example.org/foto.jpg',
    );
    expect(screen.getByText(/Autore di prova/)).toHaveTextContent('CC BY');
    expect(screen.getByText(/Immagine modificata/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Fonte/ })).not.toBeInTheDocument();
});

test('copertina non caricabile passa alla grafica Club', async () => {
    apri('/album/21', {
        'GET /api/album/21': json(200, { ...ALBUM, copertinaUrl: 'https://example.org/cover.jpg' }),
    });
    const immagine = await screen.findByRole('img', { name: 'Copertina di Circuiti Notturni' });
    fireEvent.error(immagine);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('Grafica Club')).toBeInTheDocument();
});

test('cambio ID: la risposta del vecchio artista non sostituisce il nuovo dettaglio', async () => {
    const prima = differita<Response>();
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/artisti/1': () => prima.promessa,
        'GET /api/artisti/2': json(200, {
            ...ARTISTA,
            id: 2,
            nome: 'Sunset Grid',
            brani: [],
            album: [],
            eventi: [],
        }),
    });
    function CambiaArtista() {
        const naviga = useNavigate();
        return <button onClick={() => naviga('/artisti/2')}>Cambia artista</button>;
    }
    render(
        <MemoryRouter initialEntries={['/artisti/1']}>
            <ProviderAutenticazione>
                <CambiaArtista />
                <App />
            </ProviderAutenticazione>
        </MemoryRouter>,
    );
    await waitFor(() => expect(backend.di('GET', '/api/artisti/1')).toHaveLength(1));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cambia artista' }));
    await titolo('Sunset Grid');
    await act(async () => prima.risolvi(json(200, ARTISTA)));
    expect(
        screen.queryByRole('heading', { level: 1, name: 'Nova Circuit' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sunset Grid' })).toBeInTheDocument();
});

test('foto artista provider senza crediti locali: visibile, errore con segnaposto', async () => {
    const foto = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    apri('/artisti/1', { 'GET /api/artisti/1': json(200, { ...ARTISTA, immagine_url: foto, credito_immagine: null }) });
    const immagine = await screen.findByRole('img', { name: 'Foto di Nova Circuit' });
    expect(immagine).toHaveAttribute('src', foto); expect(screen.queryByText(/Foto:/)).not.toBeInTheDocument();
    fireEvent.error(immagine); expect(screen.queryByRole('img', { name: 'Foto di Nova Circuit' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Grafica Club').length).toBeGreaterThan(0);
});

test('ritratto artista nel hero accanto al nome, presente/errore/assenza condividono lo stesso riquadro', async () => {
    const foto = 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg';
    apri('/artisti/1', { 'GET /api/artisti/1': json(200, { ...ARTISTA, immagine_url: foto }) });
    const nome = await titolo('Nova Circuit');
    const ritratto = screen.getByRole('img', { name: 'Foto di Nova Circuit' });
    const hero = nome.closest('[class*="vetrina"]');
    expect(hero).toContainElement(ritratto);
    const riquadro = ritratto.parentElement;
    fireEvent.error(ritratto);
    expect(riquadro).toHaveTextContent('Grafica Club');
    expect(hero).toContainElement(riquadro);
    expect(screen.queryByRole('img', { name: 'Foto di Nova Circuit' })).not.toBeInTheDocument();
});


test('biografia e fan Deezer dentro il hero con il ritratto, cambio IT/EN senza nuove richieste', async () => {
    const backend = apri('/artisti/1', { 'GET /api/artisti/1': json(200, { ...ARTISTA, bio: null,
        biografia: { it: 'Biografia verificata italiana.', en: 'Verified English biography.', fonteUrl: 'https://example.org/artista' },
        popolarita_deezer: { fan: 12345, url: 'https://www.deezer.com/artist/3951', aggiornato_at: '2026-10-05T10:00:00Z' } }) });
    await titolo('Nova Circuit');
    const sezione = screen.getByRole('region', { name: 'Biografia' });
    expect(within(sezione).getByText('Biografia verificata italiana.')).toBeInTheDocument();
    expect(within(sezione).getByText('12.345')).toBeInTheDocument();
    expect(within(sezione).getByText('Fan su Deezer')).toBeInTheDocument();
    expect(within(sezione).queryByRole('link', { name: /Fonte della biografia/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Dietro la musica')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Nova Circuit' }).closest('[class*="vetrina"]')).toContainElement(sezione);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByText('Verified English biography.')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('Fans on Deezer')).toBeInTheDocument();
    expect(backend.di('GET', '/api/artisti/1')).toHaveLength(1);
});
test('bio curata prevale, fan assenti non diventano zero e zero reale viene mostrato', async () => {
    apri('/artisti/1', { 'GET /api/artisti/1': json(200, { ...ARTISTA,
        biografia: { it: 'Fallback', en: 'Fallback', fonteUrl: null },
        popolarita_deezer: { fan: 0, url: null, aggiornato_at: null } }) });
    await titolo('Nova Circuit');
    expect(screen.getByText(ARTISTA.bio)).toBeInTheDocument();
    expect(screen.queryByText('Fallback')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Biografia' })).getByText('0')).toBeInTheDocument();
});
