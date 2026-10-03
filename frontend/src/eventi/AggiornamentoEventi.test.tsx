import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { leggiStatoSincronizzazione } from '../api/eventi';
import { json, renderizzaApp, SESSIONE_NON_VALIDA, simulaBackend } from '../test/backend';
import { t } from '../localizzazione/lingua';

const STATO = { configurata: true, attiva: true, ultimo_tentativo: '2026-10-03T10:00:00Z',
    ultimo_successo: '2026-10-01T10:00:00Z', dati_vecchi: false, errore_temporaneo: false,
    parziale: false, intervallo_secondi: 28800 };
const EVENTO = { id: 42, titolo: 'Concerto locale', data_evento: '2027-03-10', ora_evento: '21:00:00',
    luogo: 'Club', citta: 'Milano', latitudine: 45, longitudine: 9, lineup: [], fonte: 'ticketmaster',
    stato_fonte: 'rescheduled', ultimo_controllo: '2026-10-03T10:00:00Z', assente_fonte: true, modifiche_fonte: true };
function prepara(stato: Response) {
    return simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/eventi?filtro=tutti': json(200, [EVENTO]),
        'GET /api/eventi/sincronizzazione': stato,
        'GET /api/eventi/42': json(200, EVENTO) });
}
test('ultimo aggiornamento e avvisi fonte conservano lista, dettaglio e filtro', async () => {
    const backend = prepara(json(200, { ...STATO, dati_vecchi: true, errore_temporaneo: true, parziale: true }));
    renderizzaApp('/eventi?filtro=tutti');
    expect(await screen.findByText(t('sync.stale'))).toBeInTheDocument();
    expect(screen.getByText(t('sync.error'))).toBeInTheDocument();
    expect(screen.getByText(t('sync.partial'))).toBeInTheDocument();
    expect(document.querySelector('time[datetime="2026-10-01T10:00:00Z"]')).toBeInTheDocument();
    const lista = await screen.findByRole('region', { name: 'Elenco degli eventi' });
    expect(within(lista).getByText(t('sync.missing'))).toBeInTheDocument();
    expect(within(lista).getByText(t('sync.changes'))).toBeInTheDocument();
    expect(within(lista).getByText(t('sync.rescheduled'))).toBeInTheDocument();
    await userEvent.setup().click(within(lista).getByRole('link', { name: /Concerto locale/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Concerto locale' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Eventi' })).toHaveAttribute('href', '/eventi?filtro=tutti');
    expect(screen.getByText(t('sync.missing'))).toBeInTheDocument();
    expect(backend.chiamate.every(c => c.metodo === 'GET')).toBe(true);
});
test('cambio IT/EN aggiorna indicazioni senza nuove chiamate alla fonte', async () => {
    const backend = prepara(json(200, STATO)); renderizzaApp('/eventi');
    await screen.findByText(t('sync.lastUpdate'));
    const richieste = backend.di('GET', '/api/eventi/sincronizzazione').length;
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByText(t('sync.lastUpdate'))).toBeInTheDocument();
    expect(screen.getByText(t('sync.missing'))).toBeInTheDocument();
    expect(backend.di('GET', '/api/eventi/sincronizzazione')).toHaveLength(richieste);
    expect(backend.chiamate.every(c => c.percorso.startsWith('/api/'))).toBe(true);
});
test.each([
    [{ ...STATO, configurata: false }, 'sync.notConfigured'],
    [{ ...STATO, attiva: false }, 'sync.disabled'],
    [{ ...STATO, ultimo_successo: null }, 'sync.notYetUpdated'],
] as const)('stato configurazione %j: testo esplicito e dati disponibili', async (stato, chiave) => {
    prepara(json(200, stato)); renderizzaApp('/eventi');
    expect(await screen.findByText(t(chiave))).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Concerto locale' })).toBeInTheDocument();
});
test('errore endpoint metadati: elenco ancora utilizzabile, avviso senza dettagli interni', async () => {
    prepara(json(500, { errore: 'dettaglio-interno' })); renderizzaApp('/eventi');
    expect(await screen.findByText(t('sync.statusUnavailable'))).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Concerto locale' })).toBeInTheDocument();
    expect(screen.queryByText(/dettaglio-interno/)).not.toBeInTheDocument();
});
test.each([{ ...STATO, configurata: 'true' }, { ...STATO, ultimo_successo: 'ieri' }, { ...STATO, intervallo_secondi: -1 }])(
    'metadati API malformati rifiutati: %j', async stato => {
        prepara(json(200, stato)); await expect(leggiStatoSincronizzazione()).rejects.toThrow();
    });
