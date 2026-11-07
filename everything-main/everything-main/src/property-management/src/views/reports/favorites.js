/** Favorite reports, remembered per browser. */
const KEY = 'propertymgmt.reportFavorites';

export function favorites() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

export function toggleFavorite(id) {
  const set = favorites();
  if (set.has(id)) set.delete(id);
  else set.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {}
  return set.has(id);
}
