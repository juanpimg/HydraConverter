import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const isProdBuild =
  (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD === true;
if ('serviceWorker' in navigator && isProdBuild) {
  try {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  } catch {
    // Registro de SW best-effort: nunca debe romper la app.
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
