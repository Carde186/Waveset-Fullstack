import { expect, test } from 'vitest';
import { impostaCsrf } from './client';
import {
    rivalutaEvento,
    elencaCoda,
    leggiFonte,
    leggiRevisione,
    urlTicketmaster,
} from './adminEventi';
import { CSRF, json, simulaBackend } from '../test/backend';
test('rivalutazione usa cookie e CSRF senza decisioni manuali; ID validato', async () => {
    impostaCsrf(CSRF);
    const b = simulaBackend({
        'POST /api/admin/eventi/1/rivaluta': json(202, { stato: 'da_valutare' }),
    });
    await rivalutaEvento(1);
    expect(b.chiamate[0]?.init.credentials).toBe('same-origin');
    expect(b.chiamate[0]?.intestazioni['X-CSRF-Token']).toBe(CSRF);
    expect(b.chiamate[0]?.corpo).toBeUndefined();
    await expect(rivalutaEvento(2147483648)).rejects.toMatchObject({ stato: 400 });
    expect(b.chiamate).toHaveLength(1);
});
test('risposte malformate non diventano registro vuoto o dettaglio valido', async () => {
    simulaBackend({
        'GET /api/admin/eventi/registro': json(200, {}),
        'GET /api/admin/eventi/1': json(200, {}),
        'GET /api/admin/eventi/1/fonte': json(200, { snapshot: null }),
    });
    await expect(elencaCoda()).rejects.toMatchObject({ stato: 200 });
    await expect(leggiRevisione(1)).rejects.toMatchObject({ stato: 200 });
    await expect(leggiFonte(1)).rejects.toMatchObject({ stato: 200 });
});
test('fonte assente tollerata, errore server visibile', async () => {
    simulaBackend({
        'GET /api/admin/eventi/1/fonte': json(404, {}),
        'GET /api/admin/eventi/2/fonte': json(500, {}),
    });
    expect(await leggiFonte(1)).toBeNull();
    await expect(leggiFonte(2)).rejects.toMatchObject({ stato: 500 });
});
test('URL pubblici Ticketmaster senza query o credenziali', () => {
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
