import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { refocus } from '../ui/bits.js';

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
        cta.textContent = 'Continue with Puter';
        refocus(cta);
      }
    },
  }, 'Continue with Puter');

  return el('div.auth-view', {},
    el('img.auth-logo', { src: './icon-192.png', alt: '', 'aria-hidden': 'true' }),
    el('h1.auth-title', {}, 'Invoicing & Estimates'),
    el('p.auth-sub', {}, 'Quotes, invoices, recurring billing, receipts, and payment links. Simple on purpose.'),
    el('div.auth-features', {},
      feature('quote', 'Send an estimate, convert it to an invoice in one tap'),
      feature('repeat', 'Recurring invoices write themselves on schedule'),
      feature('link', 'Share a payment link so clients can pay you instantly')
    ),
    cta,
    el('p.auth-note', {}, 'Free · No ads · Your data stays in your own ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'), ' cloud')
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 18, 1.5) }, el('span', {}, text));
  }
}
