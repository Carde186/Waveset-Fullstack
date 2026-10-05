import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { DiscografiaArtista } from './DiscografiaArtista';
import { Vetrina } from './Vetrina';
import { differita, json, simulaBackend } from '../test/backend';
const cover = 'https://cdn-images.dzcdn.net/images/cover/reale/500x500.jpg';
const brano = { externalId: '12', titolo: 'Brano Deezer', urlDeezer: 'https://www.deezer.com/track/12', copertinaUrl: cover };
const album = { externalId: '123', titolo: 'EP Deezer', tipo: 'ep', dataPubblicazione: '2026-10-01', urlDeezer: 'https://www.deezer.com/album/123', copertinaUrl: cover };
const dati = { disponibile: true, externalId: '3951', brani: [brano], pubblicazioni: [album], prossimoIndice: 12 };
function apri(rotte: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({ 'GET /api/artisti/38/discografia?indice=0': json(200, dati), ...rotte });
    render(<DiscografiaArtista id={38} />); return backend;
}
test('Discografia: immagini album/brano e link diretti Deezer, nessuna richiesta Spotify o playback', async () => {
    const backend = apri();
    const top = await screen.findByRole('region', { name: 'Brani popolari' });
    expect(within(top).getByRole('img', { name: 'Copertina di Brano Deezer' })).toHaveAttribute('src', cover);
    expect(screen.getByRole('link', { name: 'Ascolta Brano Deezer su Deezer' })).toHaveAttribute('href', brano.urlDeezer);
    expect(screen.getByRole('link', { name: 'Ascolta EP Deezer su Deezer' })).toHaveAttribute('href', album.urlDeezer);
    expect(screen.getByText('EP')).toBeInTheDocument();
    expect(backend.chiamate.every(c => c.metodo === 'GET' && !c.percorso.includes('spotify'))).toBe(true);
    expect(document.querySelector('audio')).toBeNull();
});
test('Discografia: Mostra altri conserva top10, deduplica e aggiunge singoli; errore riprovabile', async () => {
    let n = 0;
    const backend = apri({ 'GET /api/artisti/38/discografia?indice=12': () => ++n === 1 ? json(503, {}) : json(200, { ...dati,
        brani: [], pubblicazioni: [album, { ...album, externalId: '124', titolo: 'Singolo Deezer', tipo: 'single', urlDeezer: 'https://www.deezer.com/album/124' }], prossimoIndice: null }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mostra altri' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('non è disponibile');
    await user.click(screen.getByRole('button', { name: 'Mostra altri' }));
    expect(await screen.findByRole('heading', { name: 'Singolo Deezer' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'EP Deezer' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Brano Deezer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostra altri' })).toBeNull();
    expect(backend.di('GET', '/api/artisti/38/discografia?indice=12')).toHaveLength(2);
});
test('Discografia: immagini assenti/in errore non usano foto artista; logo ufficiale assente mantiene link testuale', async () => {
    apri({ 'GET /api/artisti/38/discografia?indice=0': json(200, { ...dati, pubblicazioni: [{ ...album, copertinaUrl: null }] }) });
    const img = await screen.findByRole('img', { name: 'Copertina di Brano Deezer' }); fireEvent.error(img);
    expect(screen.getAllByLabelText('Copertina non disponibile')).toHaveLength(2);
    const link = screen.getByRole('link', { name: 'Ascolta Brano Deezer su Deezer' });
    fireEvent.error(link.querySelector('img')!); expect(link).toHaveTextContent('Ascolta su Deezer');
    expect(document.querySelector('img[src*="/images/artist/"]')).toBeNull();
});
test('Discografia: loading, errore e nessun link confermato sono stati distinti', async () => {
    const attesa = differita<Response>();
    apri({ 'GET /api/artisti/38/discografia?indice=0': () => attesa.promessa });
    expect(screen.getByText('Caricamento discografia…')).toBeInTheDocument();
    attesa.risolvi(json(200, { disponibile: false, brani: [], pubblicazioni: [], prossimoIndice: null }));
    expect(await screen.findByText('Discografia Deezer non ancora disponibile per questo artista.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
});
test('Vetrina: copertine ufficiali coerenti con la pagina, mai ritratti; fallback immagine e nessun pallino', async () => {
    simulaBackend({ 'GET /api/catalogo/copertine': json(200, [
        { id: 'album-1', tipo: 'album', titolo: 'Album', url: cover },
        { id: 'evento-1', tipo: 'evento', titolo: 'Pacha', url: 'https://s1.ticketm.net/dam/a/cover.jpg' },
        { id: 'album-2', tipo: 'album', titolo: 'Ritratto', url: 'https://cdn-images.dzcdn.net/images/artist/foto.jpg' },
    ]) });
    render(<MemoryRouter initialEntries={['/eventi']}><Vetrina><h1>Eventi</h1></Vetrina></MemoryRouter>);
    const pacha = await screen.findByRole('img', { name: 'Copertina di Pacha' });
    expect(screen.getByTestId('copertine-vetrina').firstElementChild).toBe(pacha);
    expect(screen.queryByRole('img', { name: 'Copertina di Ritratto' })).toBeNull();
    fireEvent.error(pacha); expect(screen.queryByText('◌')).toBeNull();
});

test('Vetrina: cambiare pagina cambia le immagini senza nuove richieste al catalogo', async () => {
    const backend = simulaBackend({ 'GET /api/catalogo/copertine': json(200, Array.from({ length: 12 }, (_, i) => ({
        id: `evento-${i}`, tipo: 'evento', titolo: `Evento ${i}`, url: `https://s1.ticketm.net/dam/a/copertina-${i}.jpg`,
    }))) });
    render(<MemoryRouter initialEntries={['/accedi']}><Link to="/registrati">Registrazione</Link><Vetrina><h1>Waveset</h1></Vetrina></MemoryRouter>);
    const hero = screen.getByTestId('copertine-vetrina');
    await within(hero).findAllByRole('img');
    const prima = within(hero).getAllByRole('img').map(img => img.getAttribute('src'));
    await userEvent.setup().click(screen.getByRole('link', { name: 'Registrazione' }));
    expect(within(hero).getAllByRole('img').map(img => img.getAttribute('src'))).not.toEqual(prima);
    expect(backend.di('GET', '/api/catalogo/copertine')).toHaveLength(1);
});
