import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import {
    ALICE,
    CSRF,
    json,
    renderizzaApp,
    SESSIONE_NON_VALIDA,
    sessioneDi,
    simulaBackend,
    senzaCorpo,
} from '../test/backend';

async function apri(rotte: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi()), ...rotte });
    renderizzaApp('/impostazioni');
    await screen.findByRole('heading', { name: 'Impostazioni account', level: 1 });
    return backend;
}
async function invia(tipo: 'email' | 'password', nuovo?: string, conferma?: string) {
    const sezione = screen.getByRole('region', {
        name: tipo === 'email' ? 'Cambia email' : 'Cambia password',
    });
    const s = within(sezione);
    fireEvent.change(s.getByLabelText('Password corrente'), {
        target: { value: 'Password-attuale-123' },
    });
    fireEvent.change(s.getByLabelText(tipo === 'email' ? 'Nuova email' : 'Nuova password'), {
        target: {
            value: nuovo ?? (tipo === 'email' ? 'nuova@esempio.test' : 'Password-nuova-123'),
        },
    });
    fireEvent.change(
        s.getByLabelText(tipo === 'email' ? 'Conferma nuova email' : 'Conferma nuova password'),
        {
            target: {
                value:
                    conferma ??
                    nuovo ??
                    (tipo === 'email' ? 'nuova@esempio.test' : 'Password-nuova-123'),
            },
        },
    );
    await userEvent.setup().click(s.getByRole('button'));
    return s;
}
test('ospite reindirizzato all’accesso senza chiamate account', async () => {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA() });
    renderizzaApp('/impostazioni');
    expect(await screen.findByRole('heading', { name: 'Accedi.' })).toBeInTheDocument();
    expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
});
test('ADMIN: impostazioni USER nascoste e nessun form anche sul link diretto', async () => {
    simulaBackend({ 'GET /api/auth/io': json(200, sessioneDi({ ...ALICE, ruolo: 'ADMIN' })) });
    renderizzaApp('/impostazioni');
    expect(
        await screen.findByText('Le impostazioni sono disponibili per gli account USER.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Password corrente')).not.toBeInTheDocument();
});
test('email valida: PATCH con CSRF, conferma, aggiornamento sessione e campi sensibili svuotati', async () => {
    const backend = await apri({
        'PATCH /api/auth/email': json(200, { utente: { ...ALICE, email: 'nuova@esempio.test' } }),
    });
    const s = await invia('email', ' NUOVA@esempio.test ', 'nuova@esempio.test');
    expect(
        await s.findByText('Email aggiornata. Usa la nuova email al prossimo accesso.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Email attuale: nuova@esempio.test')).toBeInTheDocument();
    expect(s.getByLabelText('Password corrente')).toHaveValue('');
    expect(s.getByLabelText('Nuova email')).toHaveValue('');
    const richiesta = backend.di('PATCH', '/api/auth/email')[0]!;
    expect(richiesta.intestazioni['X-CSRF-Token']).toBe(CSRF);
    expect(richiesta.corpo).toEqual({
        passwordCorrente: 'Password-attuale-123',
        nuovaEmail: 'nuova@esempio.test',
        confermaEmail: 'nuova@esempio.test',
    });
    expect(backend.di('GET', '/api/auth/io')).toHaveLength(1);
});
test.each([
    ['email', 'non-valida', 'non-valida', 'Inserisci un indirizzo email valido e non riservato.'],
    ['email', 'a@esempio.test', 'b@esempio.test', 'Le email non coincidono.'],
    ['password', 'breve', 'breve', 'La nuova password non soddisfa i requisiti indicati.'],
    ['password', 'Password-nuova-123', 'diversa', 'Le password non coincidono.'],
    [
        'password',
        'sololetterelunghe',
        'sololetterelunghe',
        'La nuova password non soddisfa i requisiti indicati.',
    ],
    [
        'password',
        'A'.repeat(71) + '12',
        'A'.repeat(71) + '12',
        'La nuova password non soddisfa i requisiti indicati.',
    ],
] as const)('validazione %s: %s', async (tipo, nuovo, conferma, messaggio) => {
    const backend = await apri();
    const s = await invia(tipo, nuovo, conferma);
    expect(s.getByText(messaggio)).toBeInTheDocument();
    expect(backend.chiamate.every((c) => c.metodo === 'GET')).toBe(true);
});
test.each([
    ['email', 409, 'EMAIL_EXISTS', 'Questa email è già registrata.'],
    ['email', 400, 'CURRENT_PASSWORD_INVALID', 'La password corrente non è corretta.'],
    ['password', 400, 'CURRENT_PASSWORD_INVALID', 'La password corrente non è corretta.'],
    ['password', 400, 'INVALID_INPUT', 'Controlla i dati inseriti.'],
    ['email', 500, null, "Non è possibile aggiornare l'account. Riprova più tardi."],
    ['password', 500, null, "Non è possibile aggiornare l'account. Riprova più tardi."],
    ['password', 403, null, 'Operazione non consentita. Ricarica la pagina e riprova.'],
    ['password', 429, null, 'Troppi tentativi. Riprova tra qualche minuto.'],
] as const)(
    'errore %s %s %s: messaggio controllato senza dettagli o password',
    async (tipo, stato, codice, messaggio) => {
        await apri({
            [`PATCH /api/auth/${tipo}`]: json(stato, {
                codice,
                messaggio: 'SQL password_hash dettagli interni',
            }),
        });
        const s = await invia(tipo);
        expect(await s.findByRole('alert')).toHaveTextContent(messaggio);
        expect(s.getByLabelText('Password corrente')).toHaveValue('');
        if (tipo === 'password') expect(s.getByLabelText('Nuova password')).toHaveValue('');
        expect(document.body).not.toHaveTextContent('SQL password_hash');
        expect(document.body).not.toHaveTextContent('Password-attuale-123');
    },
);
test('password valida: successo 204, sessione invariata, campi mascherati e svuotati', async () => {
    const backend = await apri({ 'PATCH /api/auth/password': senzaCorpo(204) });
    const s = await invia('password');
    expect(
        await s.findByText('Password aggiornata. Usa la nuova password al prossimo accesso.'),
    ).toBeInTheDocument();
    for (const name of ['Password corrente', 'Nuova password', 'Conferma nuova password']) {
        expect(s.getByLabelText(name)).toHaveAttribute('type', 'password');
        expect(s.getByLabelText(name)).toHaveValue('');
    }
    expect(backend.di('PATCH', '/api/auth/password')[0]!.intestazioni['X-CSRF-Token']).toBe(CSRF);
    expect(backend.di('GET', '/api/auth/io')).toHaveLength(1);
});
test('sessione scaduta: ricontrollo e ritorno al login', async () => {
    let controlli = 0;
    await apri({
        'GET /api/auth/io': () =>
            ++controlli === 1 ? json(200, sessioneDi()) : SESSIONE_NON_VALIDA(),
        'PATCH /api/auth/email': json(401, { codice: 'SESSION_EXPIRED' }),
    });
    await invia('email');
    expect(await screen.findByRole('heading', { name: 'Accedi.' })).toBeInTheDocument();
});
test('cambio lingua conserva input e traduce un errore già visibile senza ripetere la richiesta', async () => {
    const backend = await apri({ 'PATCH /api/auth/email': json(409, { codice: 'EMAIL_EXISTS' }) });
    await invia('email');
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('heading', { name: 'Account settings', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This email is already registered.');
    expect(screen.getByLabelText('New email')).toHaveValue('nuova@esempio.test');
    await waitFor(() => expect(backend.di('PATCH', '/api/auth/email')).toHaveLength(1));
});

test('requisiti password rifiutati dal server: errore specifico localizzato', async () => {
    await apri({
        'PATCH /api/auth/password': json(400, {
            codice: 'INVALID_INPUT',
            campi: { nuovaPassword: 'INVALID_PASSWORD' },
        }),
    });
    const s = await invia('password');
    expect(await s.findByRole('alert')).toHaveTextContent(
        'La nuova password non soddisfa i requisiti indicati.',
    );
});
