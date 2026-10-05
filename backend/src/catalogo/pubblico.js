// Esclusione esplicita dei quattro artisti inventati del seed dimostrativo.
// I record, i follow e le playlist restano nel DB; ADMIN continua a vederli.
const DEMO = ['Nova Circuit', 'Sunset Grid', 'Lucent Wave', 'Break Signal'];
function artistaPubblico(alias = 'a') {
    if (!/^[a-z_]+$/.test(alias)) throw new Error('Alias catalogo non valido');
    return `${alias}.nome NOT IN (${DEMO.map(n => `'${n}'`).join(',')})`;
}
const EVENTO_PUBBLICO = `NOT EXISTS (SELECT 1 FROM evento_artista demo_ea
    JOIN artista demo_a ON demo_a.id=demo_ea.artista_id
    WHERE demo_ea.evento_id=e.id AND NOT (${artistaPubblico('demo_a')}))`;
module.exports = { DEMO, artistaPubblico, EVENTO_PUBBLICO };
