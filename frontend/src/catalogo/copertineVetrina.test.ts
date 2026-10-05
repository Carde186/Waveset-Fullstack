import { expect, test } from 'vitest';
import { selezionaCopertine } from './copertineVetrina';
import type { CopertinaVetrina } from '../api/discografia';

const pagine = ['/eventi', '/esplora', '/accedi', '/registrati', '/area',
    '/artisti-seguiti', '/impostazioni', '/admin/artisti', '/admin/eventi'];
const cover = (i: number): CopertinaVetrina => ({ id: `evento-${i}`, titolo: `Evento ${i}`, tipo: 'evento', url: `https://s1.ticketm.net/dam/a/cover-${i}.jpg` });

test.each([9, 11, 12, 24, 30])('%s copertine reali: composizione e immagine principale differenti per ogni pagina, scelte stabili', numero => {
    const dati = Array.from({ length: numero }, (_, i) => cover(i));
    const selezioni = pagine.map(p => selezionaCopertine(dati, p));
    expect(new Set(selezioni.map(s => s[0]?.url)).size).toBe(pagine.length);
    expect(new Set(selezioni.map(s => s.map(c => c.url).sort().join('|'))).size).toBe(pagine.length);
    selezioni.forEach((s, i) => {
        expect(s).toHaveLength(3);
        expect(new Set(s.map(c => c.url)).size).toBe(3);
        expect(s).toEqual(selezionaCopertine(dati, pagine[i]!));
        s.forEach(c => expect(dati).toContain(c));
    });
});

test('copertine duplicate non si ripetono nella composizione; catalogo corto o assente senza URL inventati', () => {
    const prima = cover(1), seconda = cover(2);
    expect(selezionaCopertine([], '/area')).toEqual([]);
    expect(selezionaCopertine([prima, { ...prima, id: 'duplicato' }], '/area')).toEqual([prima]);
    const scelte = selezionaCopertine([prima, { ...prima, id: 'duplicato' }, seconda], '/registrati');
    expect(scelte).toHaveLength(2); expect(new Set(scelte.map(c => c.url)).size).toBe(2);
});
