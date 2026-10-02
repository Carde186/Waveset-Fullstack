import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// Guardia della direzione visiva «Club»: i valori vengono dall'anteprima approvata
// (waveset-club-anteprima-schermate.html). Se un colore non è in questo elenco, il
// test fallisce: si aggiunge solo con un riferimento approvato, mai per comodità.
const COLORI_ANTEPRIMA_CLUB = new Set([
    '#090d0c',
    '#090d0cf2',
    '#092b24',
    '#0b2a2a',
    '#0e1a1d',
    '#0f343a',
    '#101b22',
    '#102019',
    '#10957c',
    '#11645a',
    '#122018',
    '#12201a',
    '#131c13',
    '#132016',
    '#132116',
    '#14201a',
    '#142519',
    '#15191a',
    '#152114',
    '#154b37',
    '#16251c',
    '#162e29',
    '#17261b',
    '#17391a',
    '#18231a',
    '#18251a',
    '#182a1d',
    '#1a281d',
    '#1b2e21',
    '#203526',
    '#213829',
    '#34683c',
    '#354636',
    '#3c583f',
    '#3f7053',
    '#456d51',
    '#497a44',
    '#4f915b',
    '#518853',
    '#537148',
    '#537243',
    '#563643',
    '#567056',
    '#56816a',
    '#608843',
    '#779e60',
    '#80ad4a',
    '#80e9a7',
    '#85a859',
    '#879b88',
    '#92a87a36',
    '#92a87a44',
    '#9bb342',
    '#a3b1a3',
    '#a6c999',
    '#a8bbab',
    '#a8ca9b',
    '#aadf61',
    '#adb9a9',
    '#adc2ad',
    '#afbeae',
    '#b2de52',
    '#b6c4b5',
    '#b6c5b4',
    '#b9c8b5',
    '#d0e961',
    '#d1e2ce',
    '#d3dfcf',
    '#d4e4cd',
    '#d6ff7d',
    '#d8ff58',
    '#d8ff5836',
    '#e3f1da',
    '#ebd066',
    '#edff8a',
    '#edff9c70',
    '#efff97',
    '#efffa1',
    '#f6f8f2',
    '#f7fff4',
    '#fff',
]);

function fileCss(cartella: string): string[] {
    return readdirSync(cartella).flatMap((nome) => {
        const percorso = join(cartella, nome);

        if (statSync(percorso).isDirectory()) {
            return fileCss(percorso);
        }

        return nome.endsWith('.css') ? [percorso] : [];
    });
}

const radiceSorgenti = join(import.meta.dirname, '..');
const elencoCss = fileCss(radiceSorgenti);

describe("token dell'identità Club", () => {
    const token = readFileSync(join(radiceSorgenti, 'stile', 'token.css'), 'utf8');

    test.each([
        ['--sfondo', '#090d0c'],
        ['--pannello', '#14201a'],
        ['--pannello-2', '#1b2e21'],
        ['--linea', '#354636'],
        ['--lime', '#d8ff58'],
        ['--menta', '#80e9a7'],
        ['--bianco', '#f6f8f2'],
        ['--tenue', '#afbeae'],
    ])('%s = %s', (nome, valore) => {
        expect(token).toContain(`${nome}: ${valore};`);
    });

    test("i gradienti della vetrina, dell'arte e delle carte sono quelli dell'anteprima", () => {
        expect(token).toContain('linear-gradient(108deg, #213829, #11645a 80%)');
        expect(token).toContain(
            'radial-gradient(circle at 52% 42%, #efff97, #80ad4a 19%, #154b37 51%, #092b24 76%)',
        );
        expect(token).toContain('linear-gradient(130deg, #203526, #497a44 64%, #aadf61)');
    });

    test("il carattere è quello dell'anteprima, senza font esterni", () => {
        expect(token).toContain('--carattere: Arial, Helvetica, sans-serif;');
        for (const percorso of elencoCss) {
            expect(readFileSync(percorso, 'utf8')).not.toMatch(/@import|@font-face|url\(/);
        }
    });
});

describe("nessun colore fuori dall'anteprima approvata", () => {
    test.each(elencoCss.map((percorso) => [percorso.replace(radiceSorgenti, 'src')]))(
        '%s',
        (relativo) => {
            const contenuto = readFileSync(join(radiceSorgenti, '..', relativo ?? ''), 'utf8');
            const colori = (contenuto.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((c) =>
                c.toLowerCase(),
            );

            for (const colore of colori) {
                expect(
                    COLORI_ANTEPRIMA_CLUB.has(colore),
                    `${colore} non è nell'anteprima Club`,
                ).toBe(true);
            }
            // niente rgb()/hsl(): tutto passa dai valori esadecimali approvati
            expect(contenuto).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
        },
    );

    test('esiste almeno un file CSS controllato', () => {
        expect(elencoCss.length).toBeGreaterThan(5);
    });
});
