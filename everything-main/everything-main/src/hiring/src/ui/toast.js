import { el } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

let region = null;

function ensureRegion() {
  if (!region) {
    region = el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
  }
  // Mounting the app shell replaces document.body's children, which silently
  // detaches an already-created region; re-attach it or toasts never show.
  if (!region.isConnected) document.body.appendChild(region);
  return region;
}

/**
 * Attach the empty live region ahead of the first toast. Assistive tech
 * only announces mutations to live regions that were already in the
 * document — a region arriving together with its first toast reads as
 * initial content and stays silent. Call after anything that replaces
 * document.body's children (which detaches the region).
 */
export function primeToastRegion() {
  ensureRegion();
}

/**
 * How long a toast stays up. A flat 3.6s is right for "Settings saved"
 * and far too short for "Every candidate is archived. Restore one, or
 * re-engage a talent-pool member, to schedule an interview." — a hundred
 * characters that first have to be noticed, at the bottom of the screen,
 * while the reader is looking somewhere else. Scale with the message,
 * and give errors a higher floor: those are the ones to act on.
 */
function lifetime(message, type) {
  const readMs = 1500 + String(message).length * 55; // ~220 words a minute
  return Math.min(12000, Math.max(type === 'error' ? 5500 : 3600, readMs));
}

export function toast(message, type = 'success') {
  const node = el(
    'div',
    { class: `toast${type === 'error' ? ' is-error' : ''}` },
    icon(type === 'error' ? 'circle-alert' : 'circle-check', 16),
    message
  );
  ensureRegion().appendChild(node);
  setTimeout(() => node.remove(), lifetime(message, type));
}
