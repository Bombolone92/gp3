import './styles/app.css';
import { App } from './app/app.js';

const app = new App(document.getElementById('app'));
app.init().catch((err) => {
  console.error(err);
  const el = document.getElementById('app');
  el.removeAttribute('aria-busy');
  el.textContent = `Circuits could not start: ${err.message}`;
});

// Exposed for debugging from the browser console.
window.circuits = app;
