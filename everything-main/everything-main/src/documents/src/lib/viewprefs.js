/**
 * View preferences that carry from one document to the next: the zoom level
 * or fit mode. Kept in localStorage; small screens keep their own default
 * (fit to width) regardless.
 */

import { localStore as store } from './storage.js';

const KEY = 'documents:zoom';

/** Remember { fit: 'width' | 'page' } or { value: 125 }. */
export function rememberZoom({ fit = null, value = null } = {}, { storage = store() } = {}) {
  if (!storage) return;
  const pref = fit ? { fit } : (Number.isFinite(value) && value > 0 ? { value: Math.round(value) } : null);
  try {
    if (pref) storage.setItem(KEY, JSON.stringify(pref));
    else storage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

/** The remembered zoom: { fit } or { value }, or null. Values outside `min`..`max` are dropped. */
export function recallZoom({ storage = store(), min = 25, max = 400 } = {}) {
  if (!storage) return null;
  try {
    const pref = JSON.parse(storage.getItem(KEY) || 'null');
    if (!pref || typeof pref !== 'object') return null;
    if (pref.fit === 'width' || pref.fit === 'page') return { fit: pref.fit };
    const v = Number(pref.value);
    return Number.isFinite(v) && v >= min && v <= max ? { value: Math.round(v) } : null;
  } catch {
    return null;
  }
}
