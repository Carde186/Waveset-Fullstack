// Proiezione condivisa: le risposte HTTP non espongono lo snapshot raw.
function pubblico({ raw, ...profilo }) { return profilo; }
module.exports = { pubblico };
