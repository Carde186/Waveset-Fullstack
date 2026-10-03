import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ARTISTA } from '../test/catalogo';
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
import type { Evento } from '../api/eventi';

// Verifica il contratto lista → mappa senza SDK/rete; i test Eventi e Maps
// esistenti coprono AdvancedMarkerElement, click e ritorno su entrambi i filtri.
vi.mock('../eventi/MappaEventi', () => ({
    MappaEventi: ({
        eventi,
        suSelezione,
    }: {
        eventi: Evento[];
        suSelezione: (id: number) => void;
    }) => (
        <div data-testid="marker-eventi">
            {eventi
                .filter((e) => e.coordinate)
                .map((e) => (
                    <button key={e.id} onClick={() => suSelezione(e.id)}>{`Marker ${e.id}`}</button>
                ))}
        </div>
    ),
}));
const EVENTO = {
    id: 101,
    titolo: 'Live seguito',
    data_evento: '2027-02-13',
    ora_evento: null,
    luogo: 'Club',
    citta: 'Milano',
    latitudine: 45,
    longitudine: 9,
    lineup: [{ id: 1, nome: ARTISTA.nome, immagine_url: null }],
};
const ALTRO = {
    ...EVENTO,
    id: 102,
    titolo: 'Live altro artista',
    lineup: [{ id: 2, nome: 'Altro artista', immagine_url: null }],
};
const apri = (rotte: Parameters<typeof simulaBackend>[0] = {}) => {
    const backend = simulaBackend({
        'GET /api/auth/io': json(200, sessioneDi()),
        'GET /api/artisti/1': json(200, ARTISTA),
        ...rotte,
    });
    const vista = renderizzaApp('/artisti/1');
    return { backend, vista };
};

test('follow persistito: filtro seguiti, solo marker/lista pertinenti, click/dettaglio/ritorno e unfollow vuoto', async () => {
    let seguito = false;
    const { backend, vista } = apri({
        'GET /api/artisti/1': () => json(200, { ...ARTISTA, seguito }),
        'PUT /api/artisti/1/segui': () => {
            seguito = true;
            return senzaCorpo(204);
        },
        'DELETE /api/artisti/1/segui': () => {
            seguito = false;
            return senzaCorpo(204);
        },
        'GET /api/eventi?filtro=tutti': json(200, [EVENTO, ALTRO]),
        'GET /api/eventi?filtro=seguiti': () => json(200, seguito ? [EVENTO] : []),
        'GET /api/eventi/101': json(200, EVENTO),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Segui artista' }));
    expect(await screen.findByRole('button', { name: 'Smetti di seguire' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    expect(screen.getByText('Segui questo artista.')).toHaveAttribute('role', 'status');
    const richiesta = backend.di('PUT', '/api/artisti/1/segui')[0]!;
    expect(richiesta.intestazioni['X-CSRF-Token']).toBe(CSRF);
    expect(richiesta.init.credentials).toBe('same-origin');
    expect(richiesta.corpo).toBeUndefined();
    await user.click(
        within(screen.getByRole('navigation', { name: 'Principale' })).getByRole('link', {
            name: 'Eventi',
        }),
    );
    await user.click(await screen.findByRole('button', { name: 'Artisti che seguo' }));
    expect(await screen.findByText('1 evento')).toBeInTheDocument();
    expect(screen.queryByText('Live altro artista')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('marker-eventi')).getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Marker 101' }));
    expect(
        await screen.findByRole('heading', { level: 1, name: 'Live seguito' }),
    ).toBeInTheDocument();
    const ritorno = screen.getByRole('link', { name: '← Eventi' });
    expect(ritorno).toHaveAttribute('href', '/eventi?filtro=seguiti');
    await user.click(ritorno);
    expect(await screen.findByRole('button', { name: 'Artisti che seguo' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await user.click(await screen.findByRole('link', { name: /Nova Circuit/ }));
    await user.click(await screen.findByRole('button', { name: 'Smetti di seguire' }));
    expect(await screen.findByRole('button', { name: 'Segui artista' })).toHaveAttribute(
        'aria-pressed',
        'false',
    );
    expect(backend.di('DELETE', '/api/artisti/1/segui')[0]!.intestazioni['X-CSRF-Token']).toBe(
        CSRF,
    );
    vista.unmount();
    renderizzaApp('/eventi?filtro=seguiti');
    expect(
        await screen.findByRole('heading', { name: 'Nessun evento in arrivo.' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('marker-eventi')).not.toBeInTheDocument();
});

test.each(['ospite', 'ADMIN'] as const)('%s: nessun pulsante follow o mutazione', async (tipo) => {
    const { backend } = apri({
        'GET /api/auth/io':
            tipo === 'ospite'
                ? SESSIONE_NON_VALIDA()
                : json(200, sessioneDi({ ...ALICE, ruolo: 'ADMIN' })),
    });
    await screen.findByRole('heading', { name: ARTISTA.nome, level: 1 });
    expect(
        screen.queryByRole('button', { name: /Segui artista|Smetti di seguire/ }),
    ).not.toBeInTheDocument();
    expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
});

test('refresh ricostruisce lo stato seguito dal backend', async () => {
    const { vista } = apri({ 'GET /api/artisti/1': json(200, { ...ARTISTA, seguito: true }) });
    expect(await screen.findByRole('button', { name: 'Smetti di seguire' })).toBeInTheDocument();
    vista.unmount();
    renderizzaApp('/artisti/1');
    expect(await screen.findByRole('button', { name: 'Smetti di seguire' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
});

test('doppio click durante richiesta: una mutazione e nessun aggiornamento anticipato', async () => {
    const attesa = differita<Response>();
    const { backend } = apri({ 'PUT /api/artisti/1/segui': () => attesa.promessa });
    const button = await screen.findByRole('button', { name: 'Segui artista' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Aggiornamento…' })).toBeDisabled();
    expect(screen.getByText('Non segui questo artista.')).toBeInTheDocument();
    await waitFor(() => expect(backend.di('PUT', '/api/artisti/1/segui')).toHaveLength(1));
    attesa.risolvi(senzaCorpo(204));
    expect(await screen.findByRole('button', { name: 'Smetti di seguire' })).toBeInTheDocument();
});

test.each([403, 404, 500, 0])(
    'errore %s: stato conservato e messaggio controllato IT/EN',
    async (status) => {
        apri({
            'PUT /api/artisti/1/segui': () => {
                if (!status) throw new Error('Rete');
                return json(status, { messaggio: 'SQL dettagli interni' });
            },
        });
        const user = userEvent.setup();
        await user.click(await screen.findByRole('button', { name: 'Segui artista' }));
        expect(await screen.findByRole('alert')).not.toHaveTextContent('SQL dettagli interni');
        expect(screen.getByRole('button', { name: 'Segui artista' })).toHaveAttribute(
            'aria-pressed',
            'false',
        );
        await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
        expect(screen.getByRole('button', { name: 'Follow artist' })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(
            status === 403
                ? 'This action is not allowed.'
                : status === 404
                  ? 'This artist is no longer available.'
                  : 'Unable to update the follow.',
        );
    },
);

test('unfollow fallito conserva lo stato seguito', async () => {
    apri({
        'GET /api/artisti/1': json(200, { ...ARTISTA, seguito: true }),
        'DELETE /api/artisti/1/segui': json(500, {}),
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Smetti di seguire' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Smetti di seguire' })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
});

test('sessione scaduta al follow: rilegge identità e rimuove azione autenticata', async () => {
    let controlli = 0;
    apri({
        'GET /api/auth/io': () =>
            ++controlli === 1 ? json(200, sessioneDi()) : SESSIONE_NON_VALIDA(),
        'PUT /api/artisti/1/segui': json(401, {}),
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Segui artista' }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Accedi' })).toBeInTheDocument());
    expect(
        screen.queryByRole('button', { name: /Segui artista|Smetti di seguire/ }),
    ).not.toBeInTheDocument();
});
