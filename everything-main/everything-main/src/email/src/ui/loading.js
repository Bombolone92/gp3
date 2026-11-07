import { el } from './dom.js';

/** Content loads use a skeleton alone, even for long waits. Removing the node
 * cancels the reveal delay, so cached reads never flash a placeholder. */
export function loadingPlaceholder(kind, label) {
  const line = (name) => el(`span.skeleton-line.${name}`);
  const shapes = kind === 'list'
    ? Array.from({ length: 8 }, () => el('div.skeleton-row', {},
      line('skeleton-sender'), line('skeleton-subject'), line('skeleton-date')))
    : [line('skeleton-long'), line('skeleton-long'), line('skeleton-short')];
  return el(`div.loading-placeholder.loading-${kind}`, { role: 'status', 'aria-label': label },
    el('span.sr-only', {}, label),
    el('div.skeleton-shapes', { 'aria-hidden': 'true' }, shapes));
}
