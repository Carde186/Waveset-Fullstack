import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { json, renderizzaApp, SESSIONE_NON_VALIDA, simulaBackend } from '../test/backend';
import { impostaLingua, leggiLingua, STORAGE_LINGUA, t } from './lingua';
import it from './it.json';
import en from './en.json';

test('IT/EN completi, interpolazioni equivalenti e nessuna traduzione vuota', () => {
    expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(it) as (keyof typeof it)[]) {
        expect(it[key].trim()).not.toBe('');
        expect(en[key].trim()).not.toBe('');
        expect(it[key].match(/\{\w+\}/g) ?? []).toEqual(en[key].match(/\{\w+\}/g) ?? []);
    }
});
test('cambio lingua traduce navigazione/login/errori, conserva input, poi persiste al remount', async () => {
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'POST /api/auth/web/login': json(401, { messaggio: 'Email o password errati' }),
    });
    const vista = renderizzaApp('/accedi');
    await screen.findByRole('heading', { name: 'Accedi.' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'alice@esempio.test');
    await user.type(screen.getByLabelText('Password'), 'password-test');
    await user.click(screen.getByRole('button', { name: 'Accedi ↗' }));
    await screen.findByText('Email o password errati.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Lingua' }), 'en');
    expect(screen.getByRole('heading', { name: 'Log in.' })).toBeInTheDocument();
    expect(
        within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
            name: 'Explore',
        }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(within(screen.getByRole('alert')).getByText('Error')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('alice@esempio.test');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem(STORAGE_LINGUA)).toBe('en');
    expect(backend.di('POST', '/api/auth/web/login')).toHaveLength(1);
    vista.unmount();
    renderizzaApp('/accedi');
    expect(await screen.findByRole('heading', { name: 'Log in.' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
});
test('eventi in EN: testi, date, dettaglio e filtro senza modificare valori API', async () => {
    localStorage.setItem(STORAGE_LINGUA, 'en');
    const evento = {
        id: 1,
        titolo: 'Live',
        data_evento: '2027-02-13',
        ora_evento: null,
        luogo: null,
        citta: null,
        latitudine: null,
        longitudine: null,
        lineup: [],
    };
    const backend = simulaBackend({
        'GET /api/auth/io': SESSIONE_NON_VALIDA(),
        'GET /api/eventi?filtro=tutti': json(200, [evento]),
        'GET /api/eventi/1': json(200, evento),
    });
    renderizzaApp('/eventi?filtro=tutti');
    expect(await screen.findByRole('region', { name: 'Event list' })).toBeInTheDocument();
    expect(screen.getByText('1 event')).toBeInTheDocument();
    expect(screen.getByText('13 February 2027')).toBeInTheDocument();
    expect(screen.getByText(/Time unavailable/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Live ↗' }));
    expect(await screen.findByRole('link', { name: '← Events' })).toHaveAttribute(
        'href',
        '/eventi?filtro=tutti',
    );
    expect(backend.di('GET', '/api/eventi?filtro=tutti')).toHaveLength(1);
});
test('storage indisponibile: scelta in memoria senza errori', () => {
    const lettura = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error();
    });
    const scrittura = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error();
    });
    try {
        impostaLingua('en');
        expect(leggiLingua()).toBe('en');
        expect(t('account.newEmail')).toBe('New email');
    } finally {
        lettura.mockRestore();
        scrittura.mockRestore();
        impostaLingua('it');
    }
});
test('storage leggibile ma non scrivibile: cambio lingua resta utilizzabile', () => {
    const scrittura = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error();
    });
    try {
        impostaLingua('en');
        expect(leggiLingua()).toBe('en');
    } finally {
        scrittura.mockRestore();
        impostaLingua('it');
    }
});
test('nessun testo UI letterale in JSX, etichette o attributi accessibili', () => {
    const root = join(import.meta.dirname, '..');
    const attributi = new Set([
        'aria-label',
        'etichetta',
        'testo',
        'titolo',
        'messaggio',
        'occhiello',
        'suggerimento',
        'placeholder',
    ]);
    const errori: string[] = [];
    function file(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'test') file(p);
                continue;
            }
            if (!p.endsWith('.tsx') || p.includes('.test.')) continue;
            const ast = ts.createSourceFile(
                p,
                readFileSync(p, 'utf8'),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            );
            function visita(n: ts.Node) {
                if (ts.isJsxText(n) && /\p{L}/u.test(n.text)) errori.push(p + ': ' + n.text.trim());
                if (
                    ts.isJsxAttribute(n) &&
                    attributi.has(n.name.getText(ast)) &&
                    n.initializer &&
                    ts.isStringLiteral(n.initializer) &&
                    /\p{L}/u.test(n.initializer.text)
                )
                    errori.push(p + ': ' + n.initializer.text);
                if (
                    ts.isPropertyAssignment(n) &&
                    attributi.has(n.name.getText(ast)) &&
                    ts.isStringLiteral(n.initializer) &&
                    /\p{L}/u.test(n.initializer.text)
                )
                    errori.push(p + ': ' + n.initializer.text);
                ts.forEachChild(n, visita);
            }
            visita(ast);
        }
    }
    file(root);
    expect(errori).toEqual([]);
});
