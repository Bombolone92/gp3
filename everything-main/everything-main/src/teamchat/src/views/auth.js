import { el } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export function authView({ onSignedIn, pendingInvite = null }) {
  // One press at a time while Puter answers, said with aria-busy rather than
  // by disabling the button (as pressOnce in dom.js has it): a focused
  // button that is disabled hands its focus to the page body, so a sign-in
  // given up (its window closed) came back with the button live and nobody
  // on it, and the next Tab started over from the top of the page. Signed
  // in, the button stays busy: the page gives way to the app.
  const busy = () => cta.getAttribute('aria-busy') === 'true';
  const cta = el('button.btn.btn-primary.auth-cta', {
    type: 'button',
    onclick: async () => {
      if (busy()) return;
      cta.setAttribute('aria-busy', 'true');
      cta.textContent = 'Waiting for Puter';
      try {
        await puter.auth.signIn();
      } catch {
        cta.removeAttribute('aria-busy');
        cta.textContent = 'Sign in';
        return;
      }
      onSignedIn();
    },
  }, 'Sign in');

  return el('main.auth-view', {},
    el('img.auth-logo', { src: './icons/icon-192.png', width: 88, height: 88, alt: 'Teamchat logo' }),
    el('h1.auth-title', {}, 'Teamchat'),
    el('p.auth-sub', {}, pendingInvite
      ? 'You have been invited to a workspace. Sign in to join it.'
      : 'Channels, threads, and direct messages for your team. Fast, focused, and yours.'),
    el('div.auth-features', {},
      feature('hash', 'Organize work in public and private channels'),
      feature('messages', 'Keep side conversations in threads, not in the way'),
      feature('cloud', 'Runs on Puter: no servers to run, sign in with one account')),
    cta,
    el('p.auth-note', {}, 'Free. No ads. Powered by ',
      el('a', { href: 'https://developer.puter.com', target: '_blank', rel: 'noopener' }, 'Puter')));

  function feature(ic, text) {
    return el('div.auth-feature', { html: icon(ic, 20, 1.8) }, el('span', {}, text));
  }
}
