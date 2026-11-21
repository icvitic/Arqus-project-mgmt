import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Announcer } from './ui';
// WP1.25: pisma vizualnog identiteta ArQus Solutionsa – Geist (naslovi) i IBM Plex Sans (tekst) – poslužena s vlastitog
// poslužitelja (CSP `font-src 'self'`); latinica i prošireni latinični skup (č, ć, đ, š, ž).
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-ext-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist/latin-ext-600.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /><Announcer /></StrictMode>);
