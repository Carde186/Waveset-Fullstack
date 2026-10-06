import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { ALICE, CSRF, differita, json, renderizzaApp, SESSIONE_NON_VALIDA, sessioneDi, simulaBackend } from '../test/backend';

const admin = { ...ALICE, ruolo: 'ADMIN' as const };
const auth = { 'GET /api/auth/io': json(200, sessioneDi(admin)) };
const artista = { id: 5, nome: 'Artista locale' };
const profilo = { externalId: '123', name: 'Artista Deezer', url: 'https://www.deezer.com/artist/123',
    artwork: { url: 'https://cdn-images.dzcdn.net/foto.jpg', width: 600, height: 600 }, genres: ['Electronic'],
    provider: 'deezer', fan: null, ticketmaster: { stato: 'non_verificato', attractions: [], ambiguo: false, controllatoAt: null }, storefront: '', syncedAt: '2026-10-03T10:00:00Z' };
const percorso = '/api/admin/artisti/5/deezer';
const ricerca = `${percorso}/search?q=Artista+locale`;
function apri(extra: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({ ...auth, ['GET /api/admin/artisti/5/provider']: json(200, { provider: 'deezer', artista, collegamento: null }), ...extra });
    renderizzaApp('/admin/artisti/5'); return backend;
}
async function cerca() {
    const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Cerca artista' })); return user;
}
test('ospite e USER: nessuna chiamata ADMIN su lista o dettaglio', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    const vista = renderizzaApp('/admin/artisti'); await screen.findByRole('heading', { name: 'Accedi.' });
    expect(backend.chiamate).toHaveLength(1); vista.unmount();
    const user = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });
    renderizzaApp('/admin/artisti/5'); await screen.findByRole('heading', { name: 'Accesso riservato agli ADMIN.' });
    expect(user.chiamate).toHaveLength(1); expect(screen.queryByRole('link', { name: 'Gestione artisti' })).not.toBeInTheDocument();
});
test('lista: tutti gli artisti locali anche senza provider, navigazione ADMIN e link al dettaglio', async () => {
    const backend = simulaBackend({ ...auth, 'GET /api/admin/artisti/provider': json(200, { provider: 'deezer' }),
        'GET /api/admin/artisti': json(200, [{ ...artista, provider_collegato: null }]) });
    renderizzaApp('/admin/artisti');
    expect(await screen.findByRole('link', { name: 'Artista locale ↗' })).toHaveAttribute('href', '/admin/artisti/5');
    expect(screen.getByRole('link', { name: 'Gestione artisti' })).toHaveAttribute('href', '/admin/artisti');
    expect(screen.getByText('Nessun profilo collegato al provider attivo.')).toBeInTheDocument();
    expect(backend.di('GET', '/api/artisti')).toHaveLength(0);
});
test('lista di 37 artisti: 4 collegati e 33 senza provider, conteggio e IT/EN senza nuove chiamate', async () => {
    const nomi = ['Martin Garrix', 'Alesso', 'Fred again', 'BUNT.', 'ILLENIUM', 'FISHER', 'Kaskade',
        'Matisse & Sadko', 'Hardwell', 'Steve Aoki', 'Charlotte de Witte', 'Amelie Lens', 'Adam Beyer',
        'Nina Kraviz', 'Armin van Buuren', 'Black Coffee', 'Peggy Gou', 'Chris Lake', 'John Summit',
        'David Guetta', 'Above & Beyond', 'Paul van Dyk', 'Aly & Fila', 'Gareth Emery', 'Pendulum',
        'Andy C', 'Wilkinson', 'Metrik', 'Tale Of Us', 'Maceo Plex', 'Stephan Bodzin', 'Tiësto', 'Sub Focus'];
    const artisti = [...Array.from({ length: 4 }, (_, i) => ({ id: i + 1, nome: `Demo ${i + 1}`, provider_collegato: 'deezer' })),
        ...nomi.map((nome, i) => ({ id: i + 5, nome, provider_collegato: null }))];
    const backend = simulaBackend({ ...auth, 'GET /api/admin/artisti/provider': json(200, { provider: 'deezer' }),
        'GET /api/admin/artisti': json(200, artisti) });
    renderizzaApp('/admin/artisti');
    await screen.findByText('Artisti nel catalogo: 37');
    const lista = screen.getByRole('list', { name: 'Gestione artisti' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(37);
    expect(within(lista).getAllByText('Collegato a Deezer')).toHaveLength(4);
    expect(within(lista).getAllByText('Nessun profilo collegato al provider attivo.')).toHaveLength(33);
    for (const a of artisti) expect(within(lista).getByRole('link', { name: `${a.nome} ↗` })).toHaveAttribute('href', `/admin/artisti/${a.id}`);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByText('Artists in the catalog: 37')).toBeInTheDocument();
    expect(screen.getAllByText('No profile linked to the active provider.')).toHaveLength(33);
    expect(backend.di('GET', '/api/admin/artisti')).toHaveLength(1);
});
test('lista ADMIN: vuoto ed errore con retry, nessun ripiego sul catalogo pubblico', async () => {
    let n = 0;
    const backend = simulaBackend({ ...auth, 'GET /api/admin/artisti/provider': json(200, { provider: 'deezer' }),
        'GET /api/admin/artisti': () => ++n === 1 ? json(500, {}) : json(200, []) });
    renderizzaApp('/admin/artisti');
    await screen.findByText('Impossibile completare la richiesta al catalogo. Riprova più tardi.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Riprova ↗' }));
    await screen.findByText('Nessun artista locale.');
    expect(backend.di('GET', '/api/admin/artisti')).toHaveLength(2);
    expect(backend.di('GET', '/api/artisti')).toHaveLength(0);
});
test('ricerca loading, foto/nome/generi/link, selezione, conferma esplicita e salvataggio CSRF', async () => {
    const sospesa = differita<Response>();
    const backend = apri({ [`GET ${ricerca}`]: () => sospesa.promessa,
        [`POST ${percorso}/collegamento`]: json(200, { ...profilo, versione: 1 }) });
    const user = await cerca();
    expect(screen.getByText('Ricerca nel catalogo in corso…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerca artista' })).toBeDisabled();
    sospesa.risolvi(json(200, { risultati: [profilo] }));
    await screen.findByRole('radio', { name: 'Seleziona Artista Deezer' });
    expect(screen.getByRole('img')).toHaveAttribute('src', profilo.artwork.url);
    expect(screen.getByText('Electronic')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri su Deezer ↗' })).toHaveAttribute('href', profilo.url);
    await user.click(screen.getByRole('radio', { name: 'Seleziona Artista Deezer' }));
    await user.click(screen.getByRole('button', { name: 'Verifica collegamento' }));
    expect(backend.di('POST', `${percorso}/collegamento`)).toHaveLength(0);
    expect(screen.getByText(/Confermi che Artista Deezer/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conferma e salva' }));
    await screen.findByText('Collegamento artista salvato.');
    expect(backend.di('POST', `${percorso}/collegamento`)[0]?.corpo).toEqual({ external_id: '123', versione_attesa: null });
    expect(backend.di('POST', `${percorso}/collegamento`)[0]?.intestazioni['X-CSRF-Token']).toBe(CSRF);
    expect(within(screen.getByRole('region', { name: 'Profilo artista collegato' })).getByRole('heading', { name: 'Artista Deezer' })).toBeInTheDocument();
});
test('ricerca vuota e senza immagine: messaggi chiari, nessun collegamento inventato', async () => {
    apri({ [`GET ${ricerca}`]: json(200, { risultati: [] }) }); await cerca();
    await screen.findByText('Nessun artista trovato. Prova un altro nome.');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
test('ricerca: configurazione assente ed errore Deezer tradotti, retry possibile', async () => {
    let n = 0;
    apri({ [`GET ${ricerca}`]: () => ++n === 1 ? json(503, { codice: 'DEEZER_CONFIGURAZIONE' }) : json(200, { risultati: [{ ...profilo, artwork: null }] }) });
    const user = await cerca();
    expect(await screen.findByRole('alert')).toHaveTextContent('Configurazione del provider artisti assente o non valida.');
    await user.click(screen.getByRole('button', { name: 'Cerca artista' }));
    await screen.findByLabelText('Foto artista non disponibile');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('profilo già collegato esplicito; sync mantiene ID e usa versione corrente', async () => {
    const backend = apri({ ['GET /api/admin/artisti/5/provider']: json(200, { provider: 'deezer', artista, collegamento: { ...profilo, versione: 3 } }),
        [`GET ${ricerca}`]: json(200, { risultati: [profilo] }),
        [`POST ${percorso}/sincronizza`]: json(200, { ...profilo, name: 'Nome aggiornato', versione: 4 }) });
    const user = await cerca(); await screen.findByText('Collegamento attuale');
    await user.click(screen.getByRole('button', { name: 'Risincronizza metadati' }));
    await screen.findByText('Metadati artista sincronizzati.');
    expect(backend.di('POST', `${percorso}/sincronizza`)[0]?.corpo).toEqual({ versione_attesa: 3 });
    expect(within(screen.getByRole('region', { name: 'Profilo artista collegato' })).getByText('Nome aggiornato')).toBeInTheDocument();
});
test('sostituzione richiede conferma/annulla; doppio click non duplica scritture; conflitto conserva profilo', async () => {
    const sospesa = differita<Response>();
    let letture = 0;
    const backend = apri({ ['GET /api/admin/artisti/5/provider']: () => json(200, { provider: 'deezer', artista, collegamento: { ...profilo, versione: ++letture === 1 ? 5 : 6 } }),
        [`GET ${ricerca}`]: json(200, { risultati: [{ ...profilo, externalId: '456', name: 'Altro artista' }] }),
        [`POST ${percorso}/collegamento`]: () => sospesa.promessa });
    const user = await cerca(); await user.click(await screen.findByRole('radio', { name: 'Seleziona Altro artista' }));
    await user.click(screen.getByRole('button', { name: 'Verifica collegamento' }));
    expect(screen.getByText(/Stai sostituendo/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' })); expect(backend.di('POST', `${percorso}/collegamento`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Verifica collegamento' }));
    await user.dblClick(screen.getByRole('button', { name: 'Conferma e salva' }));
    expect(backend.di('POST', `${percorso}/collegamento`)).toHaveLength(1);
    expect(backend.di('POST', `${percorso}/collegamento`)[0]?.corpo).toEqual({ external_id: '456', versione_attesa: 5 });
    sospesa.risolvi(json(409, { codice: 'DEEZER_CONFLITTO' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Il collegamento è stato modificato');
    expect(within(screen.getByRole('region', { name: 'Profilo artista collegato' })).getByText('Artista Deezer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ricarica collegamento' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(backend.di('GET', '/api/admin/artisti/5/provider')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Conferma e salva' })).not.toBeInTheDocument();
});
test('errore sync conserva metadati e non invia cambi di identità; IT/EN senza nuova ricerca', async () => {
    const backend = apri({ ['GET /api/admin/artisti/5/provider']: json(200, { provider: 'deezer', artista, collegamento: { ...profilo, versione: 2 } }),
        [`POST ${percorso}/sincronizza`]: json(503, { codice: 'DEEZER_TIMEOUT' }) });
    const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Risincronizza metadati' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Il catalogo non ha risposto in tempo');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('alert')).toHaveTextContent('The catalog did not respond in time');
    expect(screen.getByRole('button', { name: 'Search artists' })).toBeInTheDocument();
    expect(backend.di('GET', '/api/admin/artisti/5/provider')).toHaveLength(1); expect(backend.di('POST', `${percorso}/collegamento`)).toHaveLength(0);
});
test('dettaglio o ricerca malformati non renderizzano URL arbitrari', async () => {
    apri({ [`GET ${ricerca}`]: json(200, { risultati: [{ ...profilo, url: 'javascript:alert(1)' }] }) }); await cerca();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Impossibile completare'));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

const tm = { stato: 'trovato', attractions: [{ id: 'tm-1', name: 'Carl Cox' }], ambiguo: false, controllatoAt: '2026-10-04T10:00:00Z' };
const deezer = { ...profilo, externalId: '3951', name: 'Carl Cox', provider: 'deezer', storefront: '', fan: 232000,
    url: 'https://www.deezer.com/artist/3951', artwork: { url: 'https://cdn-images.dzcdn.net/foto.jpg', width: 250, height: 250 }, ticketmaster: tm };
test('Deezer: provider attivo, foto/fan senza generi, conferma e badge, ricontrollo non bloccante', async () => {
    const percorsoDeezer = '/api/admin/artisti/5/deezer';
    const backend = simulaBackend({ ...auth,
        'GET /api/admin/artisti/5/provider': json(200, { provider: 'deezer', artista, collegamento: null }),
        [`GET ${percorsoDeezer}/search?q=Artista+locale`]: json(200, { risultati: [{ ...deezer, genres: [] }] }),
        [`POST ${percorsoDeezer}/collegamento`]: json(200, { ...deezer, genres: [], versione: 1 }),
        [`POST ${percorsoDeezer}/ticketmaster`]: json(200, { ...deezer, genres: [], versione: 1, ticketmaster: { ...tm, stato: 'non_verificato', attractions: [] } }),
    });
    renderizzaApp('/admin/artisti/5');
    expect(await screen.findByText('Provider attivo: Deezer')).toBeInTheDocument();
    const user = await cerca(); await user.click(await screen.findByRole('radio', { name: 'Seleziona Carl Cox' }));
    expect(screen.getByText(/232.*fan/)).toBeInTheDocument(); expect(screen.queryByText('Electronic')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri su Deezer ↗' })).toHaveAttribute('href', deezer.url);
    await user.click(screen.getByRole('button', { name: 'Verifica collegamento' }));
    await user.click(screen.getByRole('button', { name: 'Conferma e salva' }));
    await screen.findByText('Trovato su Ticketmaster');
    await user.click(screen.getByRole('button', { name: 'Ricontrolla Ticketmaster' }));
    await screen.findByText('Controllo Ticketmaster non riuscito');
    expect(within(screen.getByRole('region', { name: 'Profilo artista collegato' })).getByRole('heading', { name: 'Carl Cox' })).toBeInTheDocument();
    expect(backend.di('POST', `${percorsoDeezer}/ticketmaster`)[0]?.corpo).toEqual({ versione_attesa: 1 });
});
test.each([
    ['trovato', 'Trovato su Ticketmaster', tm.attractions],
    ['non_trovato', 'Nessun evento disponibile su Ticketmaster', []],
    ['non_verificato', 'Controllo Ticketmaster non riuscito', []],
])('Deezer: badge Ticketmaster %s e traduzione senza nuove chiamate', async (stato, testo, attractions) => {
    const backend = simulaBackend({ ...auth, 'GET /api/admin/artisti/5/provider': json(200, { provider: 'deezer', artista,
        collegamento: { ...deezer, versione: 1, ticketmaster: { ...tm, stato, attractions } } }) });
    renderizzaApp('/admin/artisti/5'); await screen.findByText(testo);
    const user = userEvent.setup(); await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('button', { name: 'Recheck Ticketmaster' })).toBeInTheDocument();
    expect(backend.di('GET', '/api/admin/artisti/5/provider')).toHaveLength(1);
});
test('Deezer: errore e vuoto distinti, omonimi Ticketmaster senza scelta automatica', async () => {
    let n = 0;
    simulaBackend({ ...auth, 'GET /api/admin/artisti/5/provider': json(200, { provider: 'deezer', artista,
        collegamento: { ...deezer, versione: 1, ticketmaster: { ...tm, ambiguo: true, attractions: [...tm.attractions, { id: 'tm-2', name: 'Carl Cox' }] } } }),
        'GET /api/admin/artisti/5/deezer/search?q=Artista+locale': () => ++n === 1 ? json(503, { codice: 'DEEZER_LIMITE' }) : json(200, { risultati: [] }),
    });
    renderizzaApp('/admin/artisti/5'); await screen.findByText(/Più attraction/);
    const user = await cerca(); await screen.findByText('Limite di richieste raggiunto. Riprova più tardi.');
    await user.click(screen.getByRole('button', { name: 'Cerca artista' })); await screen.findByText('Nessun artista trovato. Prova un altro nome.');
});

const bunt = { ...deezer, name: 'BUNT.', versione: 1, ticketmaster: { ...tm, ambiguo: true, attractionConfermata: null,
    attractions: [{ id: 'tm-a', name: 'BUNT.', url: 'https://www.ticketmaster.com/artist/1',
        spotify: 'https://open.spotify.com/artist/fixture', genere: 'Dance/Electronic' }, { id: 'tm-b', name: 'BUNT.' }] } };
const identitaPath = `${percorso}/ticketmaster/collegamento`;
function apriBunt(extra: Parameters<typeof simulaBackend>[0] = {}) {
    return apri({ 'GET /api/admin/artisti/5/provider': json(200, { provider: 'deezer', artista: { ...artista, nome: 'BUNT.' }, collegamento: bunt }), ...extra });
}
test('ricontrollo Ticketmaster fallito mostra un errore e conserva identità e profilo, poi consente il retry', async () => {
    let tentativi = 0;
    const corrente = { ...bunt, ticketmaster: { ...bunt.ticketmaster, attractionConfermata: 'tm-a' } };
    const backend = apriBunt({ 'GET /api/admin/artisti/5/provider': json(200, { provider: 'deezer', artista, collegamento: corrente }),
        [`POST ${percorso}/ticketmaster`]: () => json(200, ++tentativi === 1
            ? { ...corrente, ticketmaster: { ...corrente.ticketmaster, stato: 'non_verificato', ambiguo: false, attractions: [] } }
            : corrente) });
    const user = userEvent.setup();await user.click(await screen.findByRole('button', { name: 'Ricontrolla Ticketmaster' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossibile verificare Ticketmaster');
    expect(screen.queryByText('Controllo Ticketmaster aggiornato.')).not.toBeInTheDocument();
    expect(screen.getByText('Identità Ticketmaster confermata: tm-a')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri su Deezer ↗' })).toHaveAttribute('href', corrente.url);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to check Ticketmaster');
    await user.click(screen.getByRole('button', { name: 'Recheck Ticketmaster' }));
    await screen.findByText('Ticketmaster check updated.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(backend.di('POST', identitaPath)).toHaveLength(0);
});
test('identità Ticketmaster: candidati con riferimenti, nessuna preselezione, annulla e conferma con CSRF', async () => {
    const backend = apriBunt({ [`POST ${identitaPath}`]: json(200, { ...bunt, ticketmaster: { ...bunt.ticketmaster, attractionConfermata: 'tm-a' } }) });
    const user = userEvent.setup();
    const candidato = await screen.findByRole('radio', { name: 'Seleziona BUNT. · tm-a' });
    expect(candidato).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Seleziona BUNT. · tm-b' })).not.toBeChecked();
    expect(screen.getByRole('link', { name: 'Apri il profilo Ticketmaster ↗' })).toHaveAttribute('href', bunt.ticketmaster.attractions[0]!.url);
    expect(screen.getByRole('link', { name: 'Apri il riferimento Spotify ↗' })).toHaveAttribute('rel', 'noopener noreferrer');
    await user.click(candidato); await user.click(screen.getByRole('button', { name: 'Verifica identità Ticketmaster' }));
    expect(screen.getByText(/Confermi che il profilo tm-a corrisponde a BUNT/)).toBeInTheDocument();
    expect(backend.di('POST', identitaPath)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(backend.di('POST', identitaPath)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Verifica identità Ticketmaster' }));
    await user.click(screen.getByRole('button', { name: 'Conferma e salva identità' }));
    await screen.findByText('Identità Ticketmaster confermata: tm-a');
    expect(backend.di('POST', identitaPath)[0]?.corpo).toEqual({ attraction_id: 'tm-a', attraction_attesa: null, versione_attesa: 1 });
    expect(backend.di('POST', identitaPath)[0]?.intestazioni['X-CSRF-Token']).toBe(CSRF);
    expect(screen.queryByText(/Più attraction/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approva evento/ })).not.toBeInTheDocument();
});
test('identità Ticketmaster: doppio click, conflitto conserva il dato e ricarica prima di una nuova scelta', async () => {
    const sospesa = differita<Response>();
    const backend = apriBunt({ [`POST ${identitaPath}`]: () => sospesa.promessa });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: 'Seleziona BUNT. · tm-a' }));
    await user.click(screen.getByRole('button', { name: 'Verifica identità Ticketmaster' }));
    await user.dblClick(screen.getByRole('button', { name: 'Conferma e salva identità' }));
    expect(backend.di('POST', identitaPath)).toHaveLength(1);
    sospesa.risolvi(json(409, { codice: 'TICKETMASTER_CONFLITTO' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Il collegamento è stato modificato');
    await user.click(screen.getByRole('button', { name: 'Ricarica collegamento' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Conferma identità Ticketmaster' })).not.toBeInTheDocument());
    expect(backend.di('GET', '/api/admin/artisti/5/provider')).toHaveLength(2);
});
test('identità Ticketmaster: rimozione esplicita, stato fonte indisponibile e testi IT/EN', async () => {
    const confermata = { ...bunt, ticketmaster: { ...bunt.ticketmaster, stato: 'non_verificato', ambiguo: false, attractions: [], attractionConfermata: 'tm-a' } };
    const backend = apriBunt({ 'GET /api/admin/artisti/5/provider': json(200, { provider: 'deezer', artista, collegamento: confermata }),
        [`POST ${identitaPath}`]: json(200, { ...confermata, ticketmaster: { ...confermata.ticketmaster, attractionConfermata: null } }) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Rimuovi identità confermata' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('heading', { name: 'Confirm Ticketmaster identity' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm and save identity' }));
    await screen.findByText('Ticketmaster identity updated. Events will be reevaluated automatically.');
    expect(backend.di('POST', identitaPath)[0]?.corpo).toEqual({ attraction_id: null, attraction_attesa: 'tm-a', versione_attesa: 1 });
    expect(screen.queryByText('Confirmed Ticketmaster identity: tm-a')).not.toBeInTheDocument();
});
test('identità Ticketmaster: URL arbitrari nei candidati non vengono renderizzati', async () => {
    apriBunt({ 'GET /api/admin/artisti/5/provider': json(200, { provider: 'deezer', artista, collegamento: { ...bunt,
        ticketmaster: { ...bunt.ticketmaster, attractions: [{ id: 'tm-a', name: 'BUNT.', url: 'javascript:alert(1)' }], ambiguo: false } } }) });
    await screen.findByText('Impossibile completare la richiesta al catalogo. Riprova più tardi.');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
