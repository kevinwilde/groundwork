import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled (latin subset) so they are cached with the app and render offline.
import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-400-italic.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import { App } from './App';
import './lib/install';
import { applyTheme } from './lib/theme';
import './styles/app.css';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
