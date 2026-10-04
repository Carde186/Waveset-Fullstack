function nome(v) { return String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function applicaDecisione(input, risposta, soglia) {
    const no = motivazione => ({ decisione: 'rifiuta', motivazione });
    if (risposta.decisione !== 'approva') return no(risposta.motivazione);
    if (risposta.confidenza < soglia) return no('Confidenza inferiore alla soglia configurata.');
    if (!risposta.artista_corrispondente) return no('Il modello non conferma la corrispondenza artista.');
    if (risposta.possibile_duplicato || input.eventiRilevanti.length) return no('Possibile duplicato: stessa data e luogo.');
    const { artista, verificaTicketmaster: verifica, evento } = input;
    if (!artista.providerExternalId || !nome(artista.nomeProvider) || nome(artista.nome) !== nome(artista.nomeProvider)) return no('Profilo provider assente o nome artista incoerente.');
    if (!evento.data || !evento.venue || evento.dataIncerta || ['canceled', 'postponed', 'unknown'].includes(evento.statoFonte)) return no('Dati evento insufficienti o stato fonte non sicuro.');
    if (evento.contraddizioni) return no('I dati curati e la fonte Ticketmaster non coincidono.');
    const confermata = verifica.attractionConfermata;
    const ids = confermata ? [confermata] : verifica.stato === 'trovato' && !verifica.omonimi && verifica.attractions.length === 1 ? [verifica.attractions[0].id] : [];
    if (!ids.length || !evento.attractions.some(a => ids.includes(a.id) && nome(a.nome) === nome(artista.nomeProvider))) return no('Attraction non coincidente o identità ambigua/non verificata.');
    return { decisione: 'approva', motivazione: risposta.motivazione };
}
module.exports = { applicaDecisione, nome };
