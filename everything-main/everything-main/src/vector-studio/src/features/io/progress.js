/**
 * Progress pill for long imports: appears after a short delay (quick
 * imports do not flash it), shows a determinate bar and percentage, marks
 * the app busy and announces itself politely to assistive technology.
 */
import { h } from '../../lib/dom.js';

export async function withProgress(app, label, fn, { delay = 200 } = {}) {
  let pill = null;
  let bar = null;
  let pct = null;
  let value = 0;
  const show = () => {
    bar = h('span.io-progress-bar', { style: `width:${Math.round(value * 100)}%` });
    pct = h('span.io-progress-pct', `${Math.round(value * 100)}%`);
    pill = h(
      'div.io-progress',
      { role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(value * 100)) },
      h('span.io-progress-label', `${label}...`),
      h('span.io-progress-track', { 'aria-hidden': 'true' }, bar),
      pct,
    );
    document.body.append(pill);
  };
  const timer = setTimeout(show, delay);
  app.root?.setAttribute('aria-busy', 'true');
  document.body.classList.add('io-busy');
  const onProgress = (v) => {
    value = Math.max(0, Math.min(1, v));
    if (!pill) return;
    const p = Math.round(value * 100);
    bar.style.width = `${p}%`;
    pct.textContent = `${p}%`;
    pill.setAttribute('aria-valuenow', String(p));
  };
  try {
    return await fn(onProgress);
  } finally {
    clearTimeout(timer);
    pill?.remove();
    app.root?.setAttribute('aria-busy', 'false');
    document.body.classList.remove('io-busy');
  }
}
