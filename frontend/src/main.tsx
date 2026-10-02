import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { ProviderAutenticazione } from './autenticazione/ContestoAutenticazione';
import './stile/token.css';
import './stile/base.css';

const radice = document.getElementById('radice');

if (radice === null) {
    throw new Error('Elemento #radice mancante in index.html');
}

createRoot(radice).render(
    <StrictMode>
        <BrowserRouter>
            <ProviderAutenticazione>
                <App />
            </ProviderAutenticazione>
        </BrowserRouter>
    </StrictMode>,
);
