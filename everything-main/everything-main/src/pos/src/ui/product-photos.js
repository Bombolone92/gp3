/**
 * In-session cache of product photos, so the register grid doesn't refetch
 * on every render. Keyed by product id + photo version: replacing a photo
 * changes the version, which is what invalidates the old entry.
 *
 * Everything here degrades to nothing: no photo, a missing file, or a failed
 * read all leave the colored dot/tile exactly as it was - the grid never
 * blanks while pictures load.
 */

import { el } from './dom.js';
import { store } from '../lib/store.js';

/** `${id}:${version}` -> Promise<objectURL | null> */
const cache = new Map();

/** The photo's object URL (cached), or null - as a promise, or null when the
    product simply has no photo (so callers can skip the async path). */
export function productPhotoUrl(product) {
  if (!product?.photo) return null;
  const key = `${product.id}:${product.photo}`;
  if (!cache.has(key)) {
    // A replaced photo leaves its old version behind; on a register tab
    // that runs all day, those pinned blobs add up. Tiles already showing
    // the old picture keep their decoded image - revoking only stops new
    // loads of the stale URL.
    for (const [stale, pending] of cache) {
      if (stale.startsWith(`${product.id}:`)) {
        cache.delete(stale);
        pending.then((url) => { if (url) URL.revokeObjectURL(url); });
      }
    }
    const pending = (async () => {
      const blob = await store.readProductPhoto(product);
      if (!blob) return null;
      return URL.createObjectURL(blob);
    })().catch(() => {
      // A failed *fetch* is not "no photo": forget the attempt, so the next
      // render retries instead of showing a bare tile until a full reload.
      if (cache.get(key) === pending) cache.delete(key);
      return null;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}

// Deleted products would otherwise keep their object URLs (and decoded
// images) pinned for the whole session - hours, on a register tab that
// runs all day.
store.addEventListener('change', () => {
  for (const [key, pending] of cache) {
    const id = key.slice(0, key.lastIndexOf(':'));
    if (store.product(id)) continue;
    cache.delete(key);
    pending.then((url) => { if (url) URL.revokeObjectURL(url); });
  }
});

/**
 * Dress a register tile with its photo once it arrives: image behind a
 * legibility scrim, name and price on top. A tile that was re-rendered
 * before the fetch resolved is simply left alone - the next render asks
 * the cache and gets the URL instantly.
 */
export function dressTile(tile, product) {
  const pending = productPhotoUrl(product);
  if (!pending) return;
  pending.then((url) => {
    if (!url || !tile.isConnected) return;
    tile.prepend(
      el('img.tile-photo', { src: url, alt: '' }),
      el('div.tile-shade')
    );
    tile.classList.add('has-photo');
  });
}

/** Swap a catalog row's letter-dot for the photo when it arrives. */
export function dressDot(dot, product) {
  const pending = productPhotoUrl(product);
  if (!pending) return;
  pending.then((url) => {
    if (!url || !dot.isConnected) return;
    dot.textContent = '';
    dot.append(el('img.dot-photo', { src: url, alt: '' }));
  });
}
