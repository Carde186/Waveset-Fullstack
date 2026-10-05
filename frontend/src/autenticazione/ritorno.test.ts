import { expect, test } from 'vitest';
import { ritornoDopoAccesso } from './ritorno';

test.each(['/artisti/1', '/artisti/2147483647', '/artisti-seguiti'])('ritorno locale consentito: %s', ritorno => {
    expect(ritornoDopoAccesso({ ritorno })).toBe(ritorno);
});
test.each([null, undefined, 'https://esterno.test', {}, { ritorno: 1 },
    ...['//esterno.test', 'https://esterno.test', '/admin/artisti', '/artisti/0', '/artisti/01',
        '/artisti/-1', '/artisti/2147483648', '/artisti/1?ritorno=https://esterno.test', '/artisti/1/../2']
        .map(ritorno => ({ ritorno })),
])('nessun redirect arbitrario da stato %j', stato => {
    expect(ritornoDopoAccesso(stato)).toBeNull();
});
