const DOMINI_TICKETMASTER = ['ticketmaster.com', 'ticketmaster.ca', 'ticketmaster.co.uk', 'ticketmaster.com.au',
    'ticketmaster.co.nz', 'ticketmaster.de', 'ticketmaster.fr', 'ticketmaster.it', 'ticketmaster.es', 'ticketmaster.nl'];
function urlPubblico(v, domini) {
    try {
        const u = new URL(v);
        if (u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash &&
            domini.some(d => u.hostname === d || u.hostname.endsWith(`.${d}`))) return u.href;
    } catch { /* Metadati facoltativi: ignorare URL non sicuri. */ }
    return null;
}
function attraction(r) {
    const genere = (Array.isArray(r.classifications) ? r.classifications : []).find(c => c?.primary)?.genre?.name;
    return { id: r.id, name: r.name, url: urlPubblico(r.url, DOMINI_TICKETMASTER),
        spotify: urlPubblico(r.externalLinks?.spotify?.[0]?.url, ['open.spotify.com']),
        genere: typeof genere === 'string' && genere.length <= 100 && genere !== 'Undefined' ? genere : null };
}
module.exports = { attraction };
