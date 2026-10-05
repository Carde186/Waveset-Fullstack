import type { CopertinaVetrina } from '../api/discografia';

// Una composizione stabile per pagina, indipendente da lingua e filtri.
// I dettagli artista/evento/album forniscono invece la loro visuale specifica.
const PAGINE = ['/eventi', '/esplora', '/accedi', '/registrati', '/area',
    '/artisti-seguiti', '/impostazioni', '/admin/artisti', '/admin/eventi'];

function coprimi(a: number, b: number): boolean {
    while (b) [a, b] = [b, a % b];
    return a === 1;
}

export function selezionaCopertine(copertine: CopertinaVetrina[], pathname: string): CopertinaVetrina[] {
    const tipo = pathname.includes('eventi') ? 'evento' : 'album';
    const ordinate = [...copertine.filter(c => c.tipo === tipo), ...copertine.filter(c => c.tipo !== tipo)];
    const viste = new Set<string>();
    const uniche = ordinate.filter(c => {
        if (viste.has(c.url)) return false;
        viste.add(c.url);
        return true;
    });
    if (!uniche.length) return [];
    const indicePagina = PAGINE.indexOf(pathname);
    const indice = indicePagina >= 0 ? indicePagina : [...pathname].reduce((somma, c) => somma + c.codePointAt(0)!, 0);
    // Passo coprimo al numero di immagini: evita la stessa composizione,
    // per esempio ogni quattro pagine quando il catalogo contiene 12 cover.
    const passo = [3, 5, 7, 1].find(p => coprimi(p, uniche.length))!;
    const inizio = (indice * passo) % uniche.length;
    return Array.from({ length: Math.min(3, uniche.length) }, (_, i) => uniche[(inizio + i) % uniche.length]!);
}
