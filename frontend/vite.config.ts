import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Il browser parla SOLO con questa origine (http://localhost:5173) e le chiamate a
// /api vengono inoltrate al backend: frontend e API restano sulla stessa origine,
// senza CORS. Il backend accetta la sessione web solo se FRONTEND_ORIGINS contiene
// esattamente questa origine: per questo la porta è fissa (strictPort) e l'host è
// "localhost" (127.0.0.1 sarebbe un'origine diversa). L'intestazione Origin la
// imposta il browser: il codice del frontend non la tocca mai.
//
// Il backend locale con la sessione web attiva ascolta di norma su 3010 (vedi
// frontend/README.md); si cambia con la variabile d'ambiente API_TARGET.
const destinazioneApi = process.env.API_TARGET ?? 'http://localhost:3010';

const inoltroApi = {
    '/api': {
        target: destinazioneApi,
        // false: l'Origin e l'host visti dal backend restano quelli del browser.
        changeOrigin: false,
    },
};

export default defineConfig({
    plugins: [react()],
    server: {
        host: 'localhost',
        port: 5173,
        strictPort: true,
        proxy: inoltroApi,
    },
    preview: {
        host: 'localhost',
        port: 5173,
        strictPort: true,
        proxy: inoltroApi,
    },
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/impostazioni.ts'],
        css: true,
        restoreMocks: true,
    },
});
