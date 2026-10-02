import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { leggiCsrf } from '../api/client';
import {
    ALICE,
    SESSIONE_NON_VALIDA,
    differita,
    json,
    renderizzaApp,
    simulaBackend,
} from '../test/backend';

async function apriRegistrazione(rotte: Parameters<typeof simulaBackend>[0] = {}) {
    const backend = simulaBackend({ 'GET /api/auth/io': SESSIONE_NON_VALIDA(), ...rotte });
    const utente = userEvent.setup();

    renderizzaApp('/registrati');
    await screen.findByRole('heading', { level: 1, name: 'Crea il tuo account.' });

    return { backend, utente };
}

async function compila(
    utente: ReturnType<typeof userEvent.setup>,
    dati: { nome?: string; email?: string; password?: string },
) {
    if (dati.nome) {
        await utente.type(screen.getByLabelText('Nome'), dati.nome);
    }
    if (dati.email) {
        await utente.type(screen.getByLabelText('Email'), dati.email);
    }
    if (dati.password) {
        await utente.type(screen.getByLabelText('Password'), dati.password);
    }
    await utente.click(screen.getByRole('button', { name: /Registrati ↗/ }));
}

const COMPLETI = {
    nome: '  Alice  ',
    email: ' alice@esempio.test ',
    password: 'una password lunga',
};

describe('schermata di registrazione', () => {
    test("mostra i campi, il suggerimento sulla password e il collegamento all'accesso", async () => {
        await apriRegistrazione();

        expect(screen.getByLabelText('Nome')).toBeInTheDocument();
        expect(screen.getByLabelText('Email')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
        expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
            'Almeno 12 caratteri, al massimo 72 byte.',
        );
        // Il collegamento nel modulo (la barra ha un altro «Accedi»).
        expect(
            within(screen.getByRole('main')).getByRole('link', { name: 'Accedi' }),
        ).toHaveAttribute('href', '/accedi');
    });

    test('campi vuoti: errori per campo e nessuna chiamata', async () => {
        const { backend, utente } = await apriRegistrazione();

        await utente.click(screen.getByRole('button', { name: /Registrati ↗/ }));

        expect(screen.getByText('Inserisci il tuo nome.')).toBeInTheDocument();
        expect(screen.getByText('Inserisci la tua email.')).toBeInTheDocument();
        expect(screen.getByText('Scegli una password.')).toBeInTheDocument();
        expect(backend.di('POST', '/api/auth/registrazione')).toHaveLength(0);
    });

    test("201: invia esattamente { nome, email, password } (senza spazi ai bordi), senza CSRF, e porta all'accesso con l'email già compilata", async () => {
        const { backend, utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': json(201, { utente: ALICE }),
        });

        await compila(utente, COMPLETI);

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Accedi.' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('Registrazione completata');
        expect(screen.getByLabelText('Email')).toHaveValue(ALICE.email);
        expect(screen.getByLabelText('Password')).toHaveValue('');

        const [registrazione] = backend.di('POST', '/api/auth/registrazione');
        expect(registrazione?.corpo).toEqual({
            nome: 'Alice',
            email: 'alice@esempio.test',
            password: 'una password lunga',
        });
        expect(registrazione?.intestazioni['X-CSRF-Token']).toBeUndefined();

        // La registrazione non apre nessuna sessione: nessun login automatico.
        expect(backend.di('POST', '/api/auth/web/login')).toHaveLength(0);
        expect(leggiCsrf()).toBeNull();
    });

    test('400 con errori per campo: ogni messaggio sotto il proprio campo', async () => {
        const { utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': json(400, {
                messaggio: 'Dati non validi',
                campi: {
                    nome: 'obbligatorio',
                    email: 'formato non valido',
                    password: 'almeno 12 caratteri',
                },
            }),
        });

        await compila(utente, { nome: 'A', email: 'x', password: 'corta' });

        expect(await screen.findByText('Almeno 12 caratteri.')).toBeInTheDocument();
        expect(screen.getByText('Formato non valido.')).toBeInTheDocument();
        expect(screen.getByText('Obbligatorio.')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInvalid();
        expect(screen.getByLabelText('Email')).toBeInvalid();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    test("400 con «dominio riservato» sull'email", async () => {
        const { utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': json(400, {
                messaggio: 'Dati non validi',
                campi: { email: 'dominio riservato' },
            }),
        });

        await compila(utente, COMPLETI);

        expect(await screen.findByText('Dominio riservato.')).toBeInTheDocument();
    });

    test('400 senza errori per campo (per esempio «corpo»): errore generale', async () => {
        const { utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': json(400, {
                messaggio: 'Dati non validi',
                campi: { corpo: 'sono ammessi solo nome, email e password' },
            }),
        });

        await compila(utente, COMPLETI);

        expect(await screen.findByRole('alert')).toHaveTextContent('Controlla i dati inseriti.');
    });

    test('409: «Questa email è già registrata.» sul campo email', async () => {
        const { utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': json(409, { messaggio: 'Email già registrata' }),
        });

        await compila(utente, COMPLETI);

        expect(await screen.findByText('Questa email è già registrata.')).toBeInTheDocument();
        expect(screen.getByLabelText('Email')).toBeInvalid();
        // Il campo email mantiene quanto scritto (jsdom toglie gli spazi ai bordi nei campi email).
        expect(screen.getByLabelText('Email')).toHaveValue('alice@esempio.test');
    });

    test('429: i secondi da attendere', async () => {
        const { utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': json(
                429,
                { messaggio: 'Troppe richieste' },
                { 'Retry-After': '300' },
            ),
        });

        await compila(utente, COMPLETI);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Troppi tentativi. Riprova tra 300 secondi.',
        );
    });

    test('403 (sessione precedente non più valida nel browser): spiega cosa fare', async () => {
        const { utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': json(403, { messaggio: 'Richiesta non consentita' }),
        });

        await compila(utente, COMPLETI);

        expect(await screen.findByRole('alert')).toHaveTextContent('una sessione non più valida');
    });

    test('rete assente e errore del backend', async () => {
        const { utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': () => {
                throw new TypeError('Failed to fetch');
            },
        });

        await compila(utente, COMPLETI);

        expect(await screen.findByRole('alert')).toHaveTextContent('Il server non risponde.');
    });

    test("durante l'invio il pulsante è disattivato e l'invio non si ripete", async () => {
        const risposta = differita<Response>();
        const { backend, utente } = await apriRegistrazione({
            'POST /api/auth/registrazione': () => risposta.promessa,
        });

        await compila(utente, COMPLETI);

        const pulsante = await screen.findByRole('button', { name: 'Registrazione in corso…' });
        expect(pulsante).toBeDisabled();
        await utente.click(pulsante);
        expect(backend.di('POST', '/api/auth/registrazione')).toHaveLength(1);

        risposta.risolvi(json(201, { utente: ALICE }));
        expect(
            await screen.findByRole('heading', { level: 1, name: 'Accedi.' }),
        ).toBeInTheDocument();
    });
});
