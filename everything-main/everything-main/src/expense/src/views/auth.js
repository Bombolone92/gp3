import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Intro page shown before sign-in: what the app does, one call to action. */
export function authView({ onSignedIn }) {
  const cta = el('button.btn.btn-primary.btn-lg.auth-cta', {
    type: 'button',
    onclick: async () => {
      cta.disabled = true;
      cta.textContent = 'Waiting for Puter';
      try {
        await puter.auth.signIn();
        onSignedIn();
      } catch {
        cta.disabled = false;
        cta.textContent = 'Continue with Puter';
      }
    },
  }, 'Continue with Puter');

  return el('div.auth-view', {},
    el('div.auth-card', {},
      el('img.auth-logo', { src: './icons/icon-192.png', width: 72, height: 72, alt: 'Expenses logo' }),
      el('h1.auth-title', {}, 'Expenses'),
      el('p.auth-sub', {}, 'Snap a receipt, let AI read it, file it in a report, and reconcile it against your card statement. Private, fast, on every device.'),
      el('ul.auth-features', {},
        feature('scan', 'Receipt capture with AI OCR', 'Merchant, date, total, tax and category are read for you. You confirm, it saves.'),
        feature('folder', 'Expense reports', 'Group expenses into reports and move them from draft to submitted, approved and reimbursed.'),
        feature('scale', 'Reconciliation', 'Import a card or bank statement and match every line to an expense, automatically where it can.'),
        feature('cloud', 'Your data, your cloud', 'Everything lives in your own Puter account. Nothing is sent anywhere else.')
      ),
      cta,
      el('p.auth-note', {}, 'Free. No ads. Powered by ',
        el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
    )
  );

  function feature(ic, title, text) {
    return el('li.auth-feature', {},
      el('span.auth-feature-ic', { html: icon(ic, 20, 1.8) }),
      el('div', {}, el('div.auth-feature-title', {}, title), el('div.auth-feature-text', {}, text))
    );
  }
}
