// Un tick viene pianificato solo DOPO la conclusione del precedente. Il
// GET_LOCK del job protegge anche dagli altri processi e dalla CLI manuale.
function avviaScheduler({ esegui, registra = console.log, ogniMs = 60000,
    pianifica = setTimeout, annulla = clearTimeout } = {}) {
    let timer, fermato = false, corrente, disabilitatoSegnalato = false;
    async function tick() {
        if (fermato) return;
        corrente = (async () => {
            try {
                const r = await esegui();
                if (!['cache', 'occupato'].includes(r.esito) && !(r.esito === 'disabilitato' && disabilitatoSegnalato)) registra('Ticketmaster sync', r);
                disabilitatoSegnalato = r.esito === 'disabilitato';
            } catch {
                registra('Ticketmaster sync', { esito: 'errore', errore: 'ERRORE_JOB' });
            }
        })();
        await corrente;
        if (!fermato) timer = pianifica(tick, ogniMs);
    }
    timer = pianifica(tick, 0);
    return { async ferma() { fermato = true; annulla(timer); await corrente; } };
}
module.exports = { avviaScheduler };
