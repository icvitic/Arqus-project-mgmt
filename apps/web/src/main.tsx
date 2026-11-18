import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Announcer } from './ui';
import './styles.css';
createRoot(document.getElementById('root')!).render(<StrictMode><App /><Announcer /></StrictMode>);
