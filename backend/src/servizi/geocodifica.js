const URL_GEOCODIFICA = 'https://maps.googleapis.com/maps/api/geocode/json';

// Fallback quando Ticketmaster non dà coordinate valide (location.latitude/
// longitude assenti o "0.000000", vedi CLAUDE.md). Stessa Google Cloud
// Console già usata per Maps, ma chiave separata e ristretta alla sola
// Geocoding API (GOOGLE_GEOCODING_API_KEY, non GOOGLE_MAPS_API_KEY): quella
// vive nel .env della root, usata da Gradle in fase di build, e non deve
// avere anche il permesso di chiamare Geocoding dal backend.
async function geocodifica(indirizzo) {
    const parametri = new URLSearchParams({
        address: indirizzo,
        key: process.env.GOOGLE_GEOCODING_API_KEY,
    });

    const risposta = await fetch(`${URL_GEOCODIFICA}?${parametri}`);
    const dati = await risposta.json();

    if (dati.status !== 'OK' || dati.results.length === 0) {
        return null;
    }

    const { lat, lng } = dati.results[0].geometry.location;
    return { latitudine: lat, longitudine: lng };
}

module.exports = { geocodifica };
