import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './client-card-overflow.css';
import './dropdown.css';

// Keep the desktop shell free of the browser's native context menu. This also
// prevents the Inspect/DevTools entry from appearing over any screen or form.
document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Keep the branded HTML boot surface visible until React has had a frame to paint.
requestAnimationFrame(() => {
  const bootScreen = document.getElementById('boot-screen');
  if (!bootScreen) return;
  bootScreen.classList.add('is-ready');
  window.setTimeout(() => bootScreen.remove(), 520);
});
