import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { ARTISTA } from '../test/catalogo';
import { ALICE, CSRF, differita, json, renderizzaApp, SESSIONE_NON_VALIDA, senzaCorpo, sessioneDi, simulaBackend } from '../test/backend';

const ARTISTI = [{ id: 1, nome: 'Carl Cox', immagine_url: 'https://cdn-images.dzcdn.net/images/artist/test/250x250.jpg' },
    { id: 2, nome: 'Alesso', immagine_url: null }];
const EVENTO = { id: 101, titolo: 'Live seguito', data_evento: '2027-02-13', ora_evento: null,
    luogo: 'Club', citta: 'Milano', latitudine: 45, longitudine: 9, lineup: [ARTISTI[0]] };

test('elenco personale, foto/fallback, rimozione confermata e refresh coerente', async () => {
    let artisti = [...ARTISTI];
    const attesa = differita<Response>();
    const backend = simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/artisti/seguiti': () => json(200, artisti),
        'DELETE /api/artisti/1/segui': async () => { const r = await attesa.promessa; artisti = artisti.filter(a => a.id !== 1); return r; },
    });
    const vista = renderizzaApp('/artisti-seguiti');
    const elenco = await screen.findByRole('list', { name: 'Artisti seguiti' });
    expect(within(elenco).getAllByRole('link')).toHaveLength(2);
    const foto = within(elenco).getByRole('img', { name: 'Foto di Carl Cox' });
    fireEvent.error(foto);
    expect(within(elenco).getAllByText('Grafica Club')).toHaveLength(2);
    const rimuovi = within(elenco).getByRole('button', { name: 'Smetti di seguire Carl Cox' });
    fireEvent.click(rimuovi); fireEvent.click(rimuovi);
    expect(rimuovi).toBeDisabled(); expect(within(elenco).getByRole('link', { name: /Carl Cox/ })).toBeInTheDocument();
    await waitFor(() => expect(backend.di('DELETE', '/api/artisti/1/segui')).toHaveLength(1));
    expect(backend.di('DELETE', '/api/artisti/1/segui')[0]?.intestazioni['X-CSRF-Token']).toBe(CSRF);
    await act(async () => attesa.risolvi(senzaCorpo(204)));
    await waitFor(() => expect(within(elenco).queryByRole('link', { name: /Carl Cox/ })).not.toBeInTheDocument());
    expect(screen.getByText('Artisti seguiti: 1 · Non segui più Carl Cox.')).toHaveAttribute('role', 'status');
    vista.unmount(); renderizzaApp('/artisti-seguiti');
    expect(within(await screen.findByRole('list', { name: 'Artisti seguiti' })).getAllByRole('link')).toHaveLength(1);
    expect(backend.di('GET', '/api/artisti/seguiti')).toHaveLength(2);
});

test('nessun follow: stato vuoto e traduzioni IT/EN senza nuova richiesta', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()), 'GET /api/artisti/seguiti': json(200, []) });
    renderizzaApp('/artisti-seguiti');
    expect(await screen.findByRole('heading', { name: 'Non segui ancora nessun artista.' })).toBeInTheDocument();
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('heading', { name: 'You are not following any artists yet.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events from followed artists' })).toHaveAttribute('href', '/eventi?filtro=seguiti');
    expect(backend.di('GET', '/api/artisti/seguiti')).toHaveLength(1);
});

test('caricamento, errore, retry; unfollow fallito mantiene la card', async () => {
    const attesa = differita<Response>(); let tentativi = 0;
    simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/artisti/seguiti': () => ++tentativi === 1 ? attesa.promessa : json(200, ARTISTI),
        'DELETE /api/artisti/1/segui': json(500, { messaggio: 'SQL privato' }) });
    renderizzaApp('/artisti-seguiti');
    expect(await screen.findByText('Caricamento artisti seguiti…')).toBeInTheDocument();
    await act(async () => attesa.risolvi(json(500, { messaggio: 'SQL privato' })));
    const errore = await screen.findByRole('alert'); expect(errore).not.toHaveTextContent('SQL privato');
    await userEvent.setup().click(within(errore).getByRole('button', { name: /Riprova/ }));
    const elenco = await screen.findByRole('list', { name: 'Artisti seguiti' });
    await userEvent.setup().click(within(elenco).getByRole('button', { name: 'Smetti di seguire Carl Cox' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non è possibile aggiornare il follow. Riprova.');
    expect(within(elenco).getByRole('link', { name: /Carl Cox/ })).toBeInTheDocument();
});

test.each(['ospite', 'ADMIN'] as const)('%s non richiede l’elenco personale', async tipo => {
    const backend = simulaBackend({ 'GET /api/auth/io': tipo === 'ospite' ? SESSIONE_NON_VALIDA() : json(200, sessioneDi({ ...ALICE, ruolo: 'ADMIN' })) });
    renderizzaApp('/artisti-seguiti');
    await screen.findByRole('heading', { name: tipo === 'ospite' ? 'Accedi.' : 'Funzione riservata agli utenti registrati.' });
    expect(backend.di('GET', '/api/artisti/seguiti')).toHaveLength(0);
    expect(within(screen.getByRole('navigation', { name: 'Principale' })).queryByRole('link', { name: 'Artisti seguiti' })).not.toBeInTheDocument();
});

test('sessione in attesa e scaduta: nessun elenco prima dell’identità o dopo logout', async () => {
    const sessione = differita<Response>(); let controlli = 0;
    const backend = simulaBackend({ 'GET /api/auth/io': () => ++controlli === 1 ? sessione.promessa : SESSIONE_NON_VALIDA(),
        'GET /api/artisti/seguiti': json(200, ARTISTI), 'DELETE /api/artisti/1/segui': json(401, {}) });
    renderizzaApp('/artisti-seguiti');
    await screen.findByText('Controllo la sessione…');
    expect(backend.di('GET', '/api/artisti/seguiti')).toHaveLength(0);
    await act(async () => sessione.risolvi(json(200, sessioneDi())));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Smetti di seguire Carl Cox' }));
    expect(await screen.findByRole('heading', { name: 'Accedi.' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Artisti seguiti' })).not.toBeInTheDocument();
});

test('follow dal profilo → pagina seguiti → eventi → dettaglio e ritorno → unfollow', async () => {
    let seguito = false;
    const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/artisti/1': () => json(200, { ...ARTISTA, nome: 'Carl Cox', seguito }),
        'PUT /api/artisti/1/segui': () => { seguito = true; return senzaCorpo(204); },
        'DELETE /api/artisti/1/segui': () => { seguito = false; return senzaCorpo(204); },
        'GET /api/artisti/seguiti': () => json(200, seguito ? [ARTISTI[0]] : []),
        'GET /api/eventi?filtro=seguiti': () => json(200, seguito ? [EVENTO] : []),
        'GET /api/eventi/101': json(200, EVENTO) });
    renderizzaApp('/artisti/1'); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Segui artista' }));
    await screen.findByRole('button', { name: 'Smetti di seguire' });
    await user.click(within(screen.getByRole('navigation', { name: 'Principale' })).getByRole('link', { name: 'Artisti seguiti' }));
    expect(within(await screen.findByRole('list', { name: 'Artisti seguiti' })).getByRole('link', { name: /Carl Cox/ })).toHaveAttribute('href', '/artisti/1');
    await user.click(screen.getByRole('link', { name: 'Eventi degli artisti seguiti' }));
    await user.click(await screen.findByRole('link', { name: /Live seguito/ }));
    const ritorno = await screen.findByRole('link', { name: '← Eventi' }); expect(ritorno).toHaveAttribute('href', '/eventi?filtro=seguiti');
    await user.click(ritorno); expect(await screen.findByText('1 evento')).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation', { name: 'Principale' })).getByRole('link', { name: 'Artisti seguiti' }));
    await user.click(await screen.findByRole('button', { name: 'Smetti di seguire Carl Cox' }));
    expect(await screen.findByRole('heading', { name: 'Non segui ancora nessun artista.' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Eventi degli artisti seguiti' }));
    expect(await screen.findByRole('heading', { name: 'Nessun evento in arrivo.' })).toBeInTheDocument();
    expect(backend.di('PUT', '/api/artisti/1/segui')).toHaveLength(1);
    expect(backend.di('DELETE', '/api/artisti/1/segui')).toHaveLength(1);
});
