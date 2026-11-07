import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

/** Signed-out intro page - the app's front door on the open web. */
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
    el('img.auth-logo', { src: './icons/icon-192.png', width: 88, height: 88, alt: 'Point of Sale logo' }),
    el('h1.auth-title', {}, 'Point of Sale'),
    el('p.auth-sub', {}, 'A fast, friendly register for small shops. Catalog, checkout, receipts, and reports.'),
    el('div.auth-features', {},
      feature('cart', 'Ring up sales in seconds with a tap-first register'),
      feature('badgePercent', 'Discounts and taxes handled exactly, to the cent'),
      feature('chart', 'Receipts and daily reports, on every device')
    ),
    cta,
    el('p.auth-note', {}, 'Free • No ads • Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter'))
  );

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
