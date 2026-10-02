import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { impostaCsrf } from '../api/client';

// Il primo rendering di un file può essere lento quando i file di test girano in
// parallelo: le attese di Testing Library sono più larghe del predefinito (1 s).
configure({ asyncUtilTimeout: 5000 });

// Ogni test parte da zero: niente token CSRF in memoria, niente dati nel browser,
// niente fetch rimasto finto.
afterEach(() => {
    cleanup();
    impostaCsrf(null);
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
});
