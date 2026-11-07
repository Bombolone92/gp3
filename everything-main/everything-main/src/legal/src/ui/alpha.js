/**
 * First-run notice that the app is an early alpha. Shown once per browser,
 * easy to dismiss, and never blocks the interface.
 */
import { h } from './dom.js';
import { icon } from './icons.js';

const KEY = 'legal.alphaNoticeSeen';

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
    h('span.alpha-icon', icon('warning', 18)),
    h(
      'div.grow',
      h('h2', 'Early alpha'),
      h('p', 'This app is still in early development. Features may change and data could be lost, so please do not use it for real client matters, trust funds, or billing yet.'),
      h('div.row', h('button.btn.sm.primary', { type: 'button', onClick: dismiss }, 'I understand')),
    ),
  );
  document.body.append(node);
}
