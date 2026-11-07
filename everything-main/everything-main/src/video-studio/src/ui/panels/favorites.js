/**
 * Favorites for library-style asset tabs (sound effects, music, graphics,
 * effects, ...). Stored per device in prefs as a list of "tab:id" keys,
 * newest first, so every tab shares one small list.
 */
import { prefs, setPref } from '../prefs.js';

const MAX = 500;
const listeners = new Set();

export const favKey = (tab, id) => `${tab}:${id}`;

function list() {
  const v = prefs().favorites;
  return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
}

export function isFavorite(tab, id) {
  return list().includes(favKey(tab, id));
}

/** Ids favorited in a tab, newest first. */
export function favoriteIds(tab) {
  const prefix = `${tab}:`;
  return list().filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

export function setFavorite(tab, id, on) {
  const key = favKey(tab, id);
  const rest = list().filter((k) => k !== key);
  setPref('favorites', (on ? [key, ...rest] : rest).slice(0, MAX));
  listeners.forEach((fn) => fn({ tab, id, on }));
  return on;
}

export function toggleFavorite(tab, id) {
  return setFavorite(tab, id, !isFavorite(tab, id));
}

/** Listen for favorite changes in any tab; returns an unsubscribe function. */
export function onFavoritesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Items of a library list for a sidebar category: 'all', 'favorites'
 * (in favorite order) or a category id matched against item[field].
 */
export function itemsFor(items, cat, { tab, field = 'cat', query = '', text = (x) => x.label } = {}) {
  let out;
  if (cat === 'favorites') {
    const byId = new Map(items.map((x) => [x.id, x]));
    out = favoriteIds(tab).map((id) => byId.get(id)).filter(Boolean);
  } else if (!cat || cat === 'all') out = items;
  else out = items.filter((x) => x[field] === cat);
  const q = String(query || '').trim().toLowerCase();
  return q ? out.filter((x) => String(text(x) || '').toLowerCase().includes(q)) : out;
}
