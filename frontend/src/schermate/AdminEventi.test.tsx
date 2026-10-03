import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import {
    ALICE,
    CSRF,
    differita,
    json,
    renderizzaApp,
    SESSIONE_NON_VALIDA,
    senzaCorpo,
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
    stato: 'in_coda',
    motivo_revisione: 'lineup_non_confermato',
    lineup: [
        {
            id: 5,
            nome: 'Carl Cox',
            id_ticketmaster: null,
            id_attraction_ticketmaster: 'attr-carl',
            collegamento_da_confermare: true,
        },
    ],
};
const fonte = {
    snapshot: {
        id_esterno: 'evt-carl',
        campi: { titolo: evento.titolo },
        attractions: [
            {
                id: 'attr-carl',
                nome: 'Carl Cox',
                url: 'https://www.ticketmaster.com/carl-cox-tickets/artist/806867',
            },
        ],
    },
    stato_fonte: 'onsale',
    ultimo_controllo: '2026-10-03T15:55:57Z',
    protetto_admin: false,
    modifiche_fonte: false,
    assente_dal: null,
};
const auth = { 'GET /api/auth/io': json(200, sessioneDi(admin)) };
function dettaglio(extra: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({
        ...auth,
        'GET /api/admin/eventi/269': json(200, evento),
        'GET /api/admin/eventi/269/fonte': json(200, fonte),
        ...extra,
    });
    renderizzaApp('/admin/eventi/269');
    return backend;
}
async function apriDialogo(azione: string) {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: azione }));
    return { user, dialogo: await screen.findByRole('dialog') };
}
test('ospite e USER non accedono a nessuna route ADMIN né interrogano la coda', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    const vista = renderizzaApp('/admin/eventi');
    await screen.findByRole('heading', { name: 'Accedi.' });
    expect(backend.chiamate).toHaveLength(1);
    vista.unmount();
    const userBackend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()) });
    renderizzaApp('/admin/eventi/269');
    await screen.findByRole('heading', { name: 'Accesso riservato agli ADMIN.' });
    expect(userBackend.chiamate).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Revisione eventi' })).not.toBeInTheDocument();
});
test('ADMIN vede solo i candidati Ticketmaster, dati, stato e collegamento al dettaglio', async () => {
    simulaBackend({
        ...auth,
        'GET /api/admin/eventi/coda': json(200, [
            evento,
            { ...evento, id: 270, titolo: 'Manuale', fonte: 'manuale' },
            { ...evento, id: 271, titolo: 'Pubblicato', stato: 'pubblicato' },
        ]),
    });
    renderizzaApp('/admin/eventi');
    const articolo = await screen.findByRole('article');
    expect(articolo).toHaveTextContent('Carl Cox @ Club');
    expect(articolo).toHaveTextContent('In revisione');
    expect(articolo).toHaveTextContent('Collegamento da confermare');
    expect(screen.getByText('1 eventi da revisionare')).toBeInTheDocument();
    expect(screen.queryByText('Manuale')).not.toBeInTheDocument();
    expect(screen.queryByText('Pubblicato')).not.toBeInTheDocument();
    expect(within(articolo).getByRole('link', { name: 'Vedi dettaglio' })).toHaveAttribute(
        'href',
        '/admin/eventi/269',
    );
    expect(screen.getByRole('link', { name: 'Revisione eventi' })).toHaveAttribute(
        'href',
        '/admin/eventi',
    );
});
test('coda vuota e errore server con retry', async () => {
    let guasto = true;
    simulaBackend({
        ...auth,
        'GET /api/admin/eventi/coda': () =>
            guasto ? json(500, { messaggio: 'SQL interno' }) : json(200, []),
    });
    renderizzaApp('/admin/eventi');
    const errore = await screen.findByRole('alert');
    expect(errore).not.toHaveTextContent('SQL interno');
    guasto = false;
    await userEvent.setup().click(within(errore).getByRole('button', { name: /Riprova/ }));
    await screen.findByRole('heading', { name: 'Nessun evento da revisionare.' });
});
test('motivi multipli dello scheduler sono tradotti, inclusi i possibili duplicati', async () => {
    simulaBackend({
        ...auth,
        'GET /api/admin/eventi/coda': json(200, [
            { ...evento, motivo_revisione: 'lineup_non_confermato; possibile_doppione' },
        ]),
    });
    renderizzaApp('/admin/eventi');
    const articolo = await screen.findByRole('article');
    expect(articolo).toHaveTextContent('Identità artista da confermare');
    expect(articolo).toHaveTextContent('Possibile evento duplicato');
    expect(articolo).not.toHaveTextContent('lineup_non_confermato');
});
test('dettaglio confronta artista e attraction, fonte e snapshot separato', async () => {
    dettaglio();
    await screen.findByRole('heading', { name: evento.titolo });
    expect(screen.getByRole('link', { name: 'Carl Cox' })).toHaveAttribute('href', '/artisti/5');
    expect(screen.getByText('Artista Waveset · ID 5')).toBeInTheDocument();
    expect(screen.getByText('Carl Cox · attr-carl')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Apri profilo Ticketmaster ↗' })).toHaveAttribute(
        'href',
        fonte.snapshot.attractions[0]!.url,
    );
    expect(document.querySelector('pre')).toHaveTextContent('evt-carl');
    expect(document.body).not.toHaveTextContent(CSRF);
});
test('conferma collegamento con CSRF, rilegge lo stato e non approva implicitamente', async () => {
    let confermato = false;
    const backend = dettaglio({
        'GET /api/admin/eventi/269': () =>
            json(200, {
                ...evento,
                lineup: [
                    {
                        ...evento.lineup[0],
                        id_ticketmaster: confermato ? 'attr-carl' : null,
                        collegamento_da_confermare: !confermato,
                    },
                ],
            }),
        'POST /api/admin/eventi/269/artisti/5/conferma-collegamento': () => {
            confermato = true;
            return senzaCorpo(204);
        },
    });
    const { user, dialogo } = await apriDialogo('Conferma collegamento');
    expect(dialogo).toHaveTextContent('Il nome da solo non prova l’identità');
    await user.click(within(dialogo).getByRole('button', { name: 'Conferma decisione' }));
    await screen.findByText('Collegamento confermato');
    expect(screen.getByText('In revisione')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conferma collegamento' })).not.toBeInTheDocument();
    expect(backend.di('POST', '/api/admin/eventi/269/approva')).toHaveLength(0);
    expect(
        backend.di('POST', '/api/admin/eventi/269/artisti/5/conferma-collegamento')[0]
            ?.intestazioni['X-CSRF-Token'],
    ).toBe(CSRF);
});
test('approva e conserva un dettaglio consultabile con link al pubblico', async () => {
    let approvato = false;
    dettaglio({
        'GET /api/admin/eventi/269': () =>
            json(200, { ...evento, stato: approvato ? 'pubblicato' : 'in_coda' }),
        'POST /api/admin/eventi/269/approva': () => {
            approvato = true;
            return senzaCorpo(204);
        },
    });
    const { user, dialogo } = await apriDialogo('Approva evento');
    expect(dialogo).toHaveTextContent('Questa azione non conferma i collegamenti artista');
    await user.click(within(dialogo).getByRole('button', { name: 'Conferma decisione' }));
    await screen.findByText('Approvato · pubblicato');
    expect(screen.getByRole('link', { name: 'Vedi evento pubblicato ↗' })).toHaveAttribute(
        'href',
        '/eventi/269',
    );
    expect(screen.queryByRole('button', { name: 'Approva evento' })).not.toBeInTheDocument();
});
test('rifiuta con motivazione, aggiorna la coda e mantiene il record', async () => {
    let scartato = false;
    const backend = simulaBackend({
        ...auth,
        'GET /api/admin/eventi/coda': () => json(200, scartato ? [] : [evento]),
        'POST /api/admin/eventi/269/scarta': () => {
            scartato = true;
            return senzaCorpo(204);
        },
    });
    renderizzaApp('/admin/eventi');
    const { user, dialogo } = await apriDialogo('Rifiuta evento');
    await user.type(
        within(dialogo).getByLabelText('Motivazione (opzionale, massimo 255 caratteri)'),
        ' Doppione verificato ',
    );
    await user.click(within(dialogo).getByRole('button', { name: 'Conferma decisione' }));
    await screen.findByText('Evento rifiutato.');
    await screen.findByRole('heading', { name: 'Nessun evento da revisionare.' });
    expect(backend.di('POST', '/api/admin/eventi/269/scarta')[0]?.corpo).toEqual({
        motivo: 'Doppione verificato',
    });
});
test('annullamento della conferma non scrive, richieste in corso disabilitano gli invii', async () => {
    const risposta = differita<Response>();
    const backend = dettaglio({ 'POST /api/admin/eventi/269/approva': () => risposta.promessa });
    const { user, dialogo } = await apriDialogo('Approva evento');
    await user.click(within(dialogo).getByRole('button', { name: 'Annulla' }));
    expect(backend.di('POST', '/api/admin/eventi/269/approva')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Approva evento' }));
    await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Conferma decisione' }),
    );
    const attesa = screen.getByRole('button', { name: 'Salvataggio…' });
    expect(attesa).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeDisabled();
    await user.click(attesa);
    expect(backend.di('POST', '/api/admin/eventi/269/approva')).toHaveLength(1);
    risposta.risolvi(json(409, {}));
    await screen.findByRole('alert');
});
test('errori 401/403/409/500 non simulano un successo e restano localizzati', async () => {
    let status = 401;
    dettaglio({
        'POST /api/admin/eventi/269/approva': () =>
            json(status, { messaggio: 'Interno riservato' }),
    });
    const { user } = await apriDialogo('Approva evento');
    for (const s of [401, 403, 409, 500]) {
        status = s;
        await user.click(
            within(screen.getByRole('dialog')).getByRole('button', { name: 'Conferma decisione' }),
        );
        const errore = await screen.findByRole('alert');
        expect(errore).not.toHaveTextContent('Interno riservato');
        expect(screen.getByText('In revisione')).toBeInTheDocument();
    }
});
test('coordinate mancanti e annullamento della fonte bloccano approvazione', async () => {
    dettaglio({
        'GET /api/admin/eventi/269': json(200, { ...evento, latitudine: null }),
        'GET /api/admin/eventi/269/fonte': json(200, { ...fonte, stato_fonte: 'canceled' }),
    });
    expect(await screen.findByRole('button', { name: 'Approva evento' })).toBeDisabled();
    expect(
        screen.getByText('Un evento annullato da Ticketmaster non può essere pubblicato.'),
    ).toBeInTheDocument();
});
test('snapshot legacy senza nomi/URL rimane consultabile', async () => {
    dettaglio({
        'GET /api/admin/eventi/269/fonte': json(200, {
            ...fonte,
            snapshot: { id_esterno: 'evt-carl' },
        }),
    });
    await screen.findByText(/Nome e URL non presenti/);
    expect(
        screen.queryByRole('link', { name: 'Apri profilo Ticketmaster ↗' }),
    ).not.toBeInTheDocument();
});
test('evento senza snapshot mostra un avviso senza impedire la revisione', async () => {
    dettaglio({ 'GET /api/admin/eventi/269/fonte': json(404, {}) });
    await screen.findByText('Snapshot della fonte non disponibile.');
    expect(screen.getByRole('button', { name: 'Rifiuta evento' })).toBeEnabled();
});
test('ID invalido non chiama API eventi, 404 reale mostra il ritorno alla coda', async () => {
    const backend = simulaBackend(auth);
    const vista = renderizzaApp('/admin/eventi/abc');
    await screen.findByRole('alert');
    expect(backend.chiamate).toHaveLength(1);
    vista.unmount();
    dettaglio({ 'GET /api/admin/eventi/269': json(404, {}) });
    await screen.findByText('Evento non disponibile per la revisione.');
    expect(screen.getByRole('link', { name: '← Coda Ticketmaster' })).toHaveAttribute(
        'href',
        '/admin/eventi',
    );
});
test('cambio lingua traduce lista, dettaglio e dialogo senza cambiare endpoint o stato', async () => {
    const backend = dettaglio();
    const { user, dialogo } = await apriDialogo('Rifiuta evento');
    await user.type(
        within(dialogo).getByLabelText('Motivazione (opzionale, massimo 255 caratteri)'),
        'Nota ADMIN',
    );
    // Nel DOM di test il dialog non rende inert gli altri controlli.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('heading', { name: 'Event data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm decision' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reason (optional, up to 255 characters)')).toHaveValue(
        'Nota ADMIN',
    );
    await waitFor(() => expect(backend.di('GET', '/api/admin/eventi/269')).toHaveLength(1));
});
