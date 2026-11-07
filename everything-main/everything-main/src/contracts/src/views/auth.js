import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Signed-out intro page: what the app does, one button to continue. */
export function authView({ onSignedIn }) {
  const cta = el('button.btn.btn-primary.auth-cta', {
    onclick: async () => {
      cta.disabled = true;
      cta.textContent = 'Waiting for Puter…';
      try {
        await puter.auth.signIn();
        onSignedIn();
      } catch {
        cta.disabled = false;
        cta.textContent = 'Sign in';
      }
    },
  }, 'Sign in');

  return el('div.auth-view', {},
    el('img.auth-logo', { src: './icon-192.png', width: 84, height: 84, alt: 'Contract Manager logo' }),
    el('h1.auth-title', {}, 'Contract Manager'),
    el('p.auth-sub', {}, 'Store agreements, stay ahead of renewals, and never miss an obligation.'),
    el('div.auth-features', {},
      feature('calendar-clock', 'Renewal dates and notice periods tracked with clear warnings'),
      feature('sparkle', 'Obligations extracted from contract text by AI, reviewed by you'),
      feature('users', 'Documents and agreements connected to the people behind them'),
      feature('cloud', 'Everything stored in your own Puter cloud, never on our servers')
    ),
    cta,
    el('p.auth-note', {}, 'Free. No ads. Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
