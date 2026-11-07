import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';
import { createBackend, isLocalMode } from './data/backend.js';
import { createApp, renderSignIn } from './app.js';
import { applyTheme, currentTheme } from './lib/theme.js';
import { h, replace } from './lib/dom.js';

applyTheme(currentTheme());

const root = document.getElementById('app');

async function boot() {
  const backend = await createBackend();
  if (!backend) {
    replace(
      root,
      h(
        'main',
        { class: 'signin', id: 'main' },
        h(
          'div',
          { class: 'signin-card' },
          h('h1', null, 'Could not start'),
          h('p', { class: 'muted' }, 'The Puter SDK did not load. Check your connection or content blockers, then reload.'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => location.reload() }, 'Reload'),
        ),
      ),
    );
    return;
  }
  if (isLocalMode()) document.documentElement.dataset.local = 'true';

  const startApp = async () => {
    const app = createApp({ backend, root });
    await app.start();
    window.__surveys = app;
  };

  if (await backend.auth.isSignedIn()) {
    await startApp();
  } else {
    renderSignIn(root, {
      onSignIn: async () => {
        await backend.auth.signIn();
        if (!(await backend.auth.isSignedIn())) throw new Error('not signed in');
        await startApp();
      },
    });
  }
}

boot();
