import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import {
    ALICE,
    CSRF,
    differita,
    json,
    renderizzaApp,
    SESSIONE_NON_VALIDA,
    sessioneDi,
    simulaBackend,
} from '../test/backend';
const admin = { ...ALICE, ruolo: 'ADMIN' as const };
const evento = {
    id: 269,
    titolo: 'Carl Cox @ Club',
    data_evento: '2027-10-09',
    ora_evento: '19:00:00',
    luogo: 'Club',
    citta: 'Dubai',
    latitudine: 25,
    longitudine: 55,
    fonte: 'ticketmaster',
    stato: 'pubblicato',
    motivo_revisione: null,
    lineup: [
        {
            id: 5,
            nome: 'Carl Cox',
            id_ticketmaster: 'carl',
            id_attraction_ticketmaster: 'carl',
            collegamento_da_confermare: false,
        },
    ],
    valutazione: {
        decisione: 'approva',
        confidenza: 0.95,
        motivazione: 'Attraction coincidente.',
        modello: 'qwen3:4b',
        data: '2026-10-04T10:00:00Z',
        tentativi: 1,
        errore: null,
    },
    audit: [],
};
const auth = { 'GET /api/auth/io': json(200, sessioneDi(admin)) };
test('ospite/USER: accesso vietato e nessuna richiesta al registro', async () => {
    const b = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    const v = renderizzaApp('/admin/eventi');
    await screen.findByRole('heading', { name: 'Accedi.' });
    expect(b.chiamate).toHaveLength(1);
    v.unmount();
    const u = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });
    renderizzaApp('/admin/eventi/269');
    await screen.findByRole('heading', { name: 'Accesso riservato agli ADMIN.' });
    expect(u.chiamate).toHaveLength(1);
});
test('registro approvati/rifiutati/in attesa, confidenza/modello, senza azioni manuali', async () => {
    simulaBackend({
        ...auth,
        'GET /api/admin/eventi/registro': json(200, [
            evento,
            {
                ...evento,
                id: 270,
                titolo: 'Ambiguo',
                stato: 'scartato',
                valutazione: { ...evento.valutazione, decisione: 'rifiuta' },
            },
            {
                ...evento,
                id: 271,
                titolo: 'Attesa',
                stato: 'da_valutare',
                valutazione: {
                    ...evento.valutazione,
                    decisione: 'da_valutare',
                    errore: 'OLLAMA_TIMEOUT',
                },
            },
        ]),
    });
    renderizzaApp('/admin/eventi');
    await screen.findByRole('heading', { name: evento.titolo });
    for (const s of ['Approvato', 'Rifiutato', 'Da valutare', 'OLLAMA_TIMEOUT'])
        expect(screen.getByText(s)).toBeInTheDocument();
    expect(screen.getAllByText('95%')).toHaveLength(3);
    expect(
        screen.queryByRole('button', {
            name: /Approva evento|Rifiuta evento|Conferma collegamento/,
        }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Rivaluta con Ollama' })[2]).toBeDisabled();
});
test('dettaglio con audit, rivalutazione 202 e CSRF, nessuna pubblicazione manuale', async () => {
    let pendente = false;
    const b = simulaBackend({
        ...auth,
        'GET /api/admin/eventi/269': () =>
            json(200, {
                ...evento,
                valutazione: pendente
                    ? { ...evento.valutazione, decisione: 'da_valutare' }
                    : evento.valutazione,
                audit: [
                    {
                        id: 1,
                        artista_id: 5,
                        generazione: 1,
                        tentativo: 1,
                        modello: 'qwen3:4b',
                        versione_prompt: 'v1',
                        iniziato_at: '2026-10-04',
                        decisione_applicata: 'approva',
                        motivazione: 'Attraction coincidente.',
                        risposta_raw: '{"decisione":"approva"}',
                    },
                ],
            }),
        'POST /api/admin/eventi/269/rivaluta': () => {
            pendente = true;
            return json(202, { stato: 'da_valutare' });
        },
    });
    renderizzaApp('/admin/eventi/269');
    await screen.findByRole('heading', { name: evento.titolo });
    expect(screen.getByText('{"decisione":"approva"}')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rivaluta con Ollama' }));
    await screen.findByText('Da valutare');
    expect(b.di('POST', '/api/admin/eventi/269/rivaluta')[0]?.intestazioni['X-CSRF-Token']).toBe(
        CSRF,
    );
    expect(screen.getByRole('button', { name: 'Rivaluta con Ollama' })).toBeDisabled();
});
test('loading, vuoto, errore caricamento ed errore rivalutazione', async () => {
    const attesa = differita<Response>();
    simulaBackend({ ...auth, 'GET /api/admin/eventi/registro': () => attesa.promessa });
    const v = renderizzaApp('/admin/eventi');
    await screen.findByText('Caricamento registro…');
    attesa.risolvi(json(200, []));
    await screen.findByText('Nessun evento Ticketmaster nel registro.');
    v.unmount();
    simulaBackend({
        ...auth,
        'GET /api/admin/eventi/269': json(200, evento),
        'POST /api/admin/eventi/269/rivaluta': json(500, {}),
    });
    const d = renderizzaApp('/admin/eventi/269');
    await screen.findByRole('heading', { name: evento.titolo });
    await userEvent.click(screen.getByRole('button', { name: 'Rivaluta con Ollama' }));
    await screen.findByText('Impossibile programmare la rivalutazione.');
    d.unmount();
    simulaBackend({ ...auth, 'GET /api/admin/eventi/registro': json(500, {}) });
    renderizzaApp('/admin/eventi');
    await screen.findByText('Registro non disponibile.');
});
