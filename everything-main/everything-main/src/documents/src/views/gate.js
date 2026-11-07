/**
 * Full-screen stand-ins for the app: the Puter SDK did not load, or the URL
 * points at a cloud document and there is no session yet to read it with.
 * Writing itself needs neither; a new document opens straight away.
 */

import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export function errorView(title, message, onRetry) {
  return el('div.auth-view.view', {},
    el('div.auth-card', {},
      el('div.empty-icon', { html: icon('wifiOff', 28) }),
      el('h1.auth-title', { style: { fontSize: '22px' } }, title),
      el('p.auth-sub', {}, message),
      el('button.btn.btn-primary.auth-cta', { type: 'button', onclick: onRetry }, 'Try again')));
}

/**
 * A document on Puter was asked for without a session. `onSignIn` opens
 * Puter's dialog (and resolves when it closes); `onSkip` starts a new document.
 */
export function signInView({ title, message, onSignIn, onSkip }) {
  const cta = el('button.btn.btn-primary', {
    type: 'button',
    onclick: async () => {
      cta.disabled = true;
      cta.textContent = 'Waiting for Puter';
      try { await onSignIn(); }
      finally { cta.disabled = false; cta.textContent = 'Sign in to Puter'; }
    },
  }, 'Sign in to Puter');
  return el('div.auth-view.view', {},
    el('div.auth-card', {},
      el('div.empty-icon', { html: icon('lock', 28) }),
      el('h1.auth-title', { style: { fontSize: '22px' } }, title),
      el('p.auth-sub', {}, message),
      el('div.row', { style: { justifyContent: 'center' } },
        cta,
        el('button.btn.btn-outline', { type: 'button', onclick: onSkip }, 'New document'))));
}
