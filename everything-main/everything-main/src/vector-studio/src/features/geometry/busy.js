/**
 * Busy state for long geometry jobs: the app root gets aria-busy, the canvas
 * shows a progress cursor and, after a short delay, a "Working" pill appears
 * so quick operations do not flash it.
 */
import { h } from '../../lib/dom.js';

let depth = 0;
let pill = null;
let timer = 0;

export async function withBusy(app, label, fn) {
  depth++;
  if (depth === 1) {
    app.root?.setAttribute('aria-busy', 'true');
    document.body.classList.add('geom-busy');
    timer = setTimeout(() => {
      pill = h('div.geom-busy-pill', { role: 'status', 'aria-live': 'polite' }, h('span.geom-spinner', { 'aria-hidden': 'true' }), `${label}...`);
      document.body.append(pill);
    }, 180);
  }
  try {
    return await fn();
  } finally {
    depth--;
    if (depth === 0) {
      clearTimeout(timer);
      pill?.remove();
      pill = null;
      app.root?.setAttribute('aria-busy', 'false');
      document.body.classList.remove('geom-busy');
    }
  }
}

export function isBusy() {
  return depth > 0;
}
