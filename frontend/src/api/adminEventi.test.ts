import { expect, test } from 'vitest';
import { impostaCsrf } from './client';
import {
    confermaCollegamento,
    decidiEvento,
    elencaCoda,
    leggiFonte,
    leggiRevisione,
    urlTicketmaster,
} from './adminEventi';
import { CSRF, json, senzaCorpo, simulaBackend } from '../test/backend';

test('mutazioni usano solo le route esistenti, cookie e CSRF; ID fuori range rifiutati', async () => {
    impostaCsrf(CSRF);
    const backend = simulaBackend({
        'POST /api/admin/eventi/1/artisti/5/conferma-collegamento': senzaCorpo(204),
        'POST /api/admin/eventi/1/approva': senzaCorpo(204),
        'POST /api/admin/eventi/1/scarta': senzaCorpo(204),
    });
    await confermaCollegamento(1, 5);
    await decidiEvento(1, 'approva');
    await decidiEvento(1, 'scarta', ' Nota ');
    expect(
        backend.chiamate.every(
            (c) => c.init.credentials === 'same-origin' && c.intestazioni['X-CSRF-Token'] === CSRF,
        ),
    ).toBe(true);
    expect(backend.chiamate[2]?.corpo).toEqual({ motivo: 'Nota' });
    await expect(decidiEvento(2147483648, 'approva')).rejects.toMatchObject({ stato: 400 });
    await expect(confermaCollegamento(1, 0)).rejects.toMatchObject({ stato: 400 });
    expect(backend.chiamate).toHaveLength(3);
});
test('risposte malformate non sono trattate come coda vuota o dettaglio valido', async () => {
    simulaBackend({
        'GET /api/admin/eventi/coda': json(200, {}),
        'GET /api/admin/eventi/1': json(200, {}),
        'GET /api/admin/eventi/1/fonte': json(200, { snapshot: null }),
    });
    await expect(elencaCoda()).rejects.toMatchObject({ stato: 200 });
    await expect(leggiRevisione(1)).rejects.toMatchObject({ stato: 200 });
    await expect(leggiFonte(1)).rejects.toMatchObject({ stato: 200 });
});
test('fonte assente tollerata, indisponibilità server non mascherata', async () => {
    simulaBackend({
        'GET /api/admin/eventi/1/fonte': json(404, {}),
        'GET /api/admin/eventi/2/fonte': json(500, {}),
    });
    expect(await leggiFonte(1)).toBeNull();
    await expect(leggiFonte(2)).rejects.toMatchObject({ stato: 500 });
});
test('URL attraction: HTTPS pubblico Ticketmaster, senza credenziali o query', () => {
    expect(urlTicketmaster('https://www.ticketmaster.com/artist/123')).toBe(
        'https://www.ticketmaster.com/artist/123',
    );
    for (const url of [
        'javascript:alert(1)',
        'https://estraneo.test/',
        'https://utente:password@ticketmaster.com/',
        'https://ticketmaster.com/?apikey=riservato',
        'http://ticketmaster.com/',
    ])
        expect(urlTicketmaster(url)).toBeNull();
});
