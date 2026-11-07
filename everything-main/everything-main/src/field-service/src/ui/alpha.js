/**
 * First-run notice that the app is an early alpha. Shown once per browser,
 * dismissable, and never blocks the interface.
 */
import { h } from './dom.js';
import { icon } from './icons.js';

const KEY = 'fieldservice.alphaNoticeSeen';

export function showAlphaNotice() {
  try {
    if (localStorage.getItem(KEY)) return;
  } catch {
    return;
  }
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, new Date().toISOString());
    } catch {}
    node.remove();
  };
  const node = h(
    'aside.alpha-notice',
    { role: 'region', 'aria-label': 'Early alpha notice' },
    h('span.icon-wrap', icon('warning', 20)),
    h(
      'div.grow',
      h('h2', 'Early alpha'),
      h(
        'p',
        'Field Service is in early development. Features may change and data could be lost, so please do not rely on it for real business records yet.',
      ),
      h('div.row', h('button.btn.sm.primary', { type: 'button', onClick: dismiss }, 'Got it')),
    ),
  );
  document.body.append(node);
}
