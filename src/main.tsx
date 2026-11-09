import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

if ('__TAURI_INTERNALS__' in window) document.documentElement.classList.add('tauri');

if (import.meta.env.DEV) {
  // Handles for UI testing over CDP (scripts/ui-check.mjs); not present in release builds.
  Promise.all([import('./stores/live'), import('./stores/ui'), import('./stores/settings')]).then(([live, ui, settings]) => {
    Object.assign(window, { __stores: { live: live.useLiveStore, ui: ui.useUiStore, settings: settings.useSettingsStore } });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
