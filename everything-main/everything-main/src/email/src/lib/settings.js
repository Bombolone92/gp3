/**
 * Per-account settings that are not flags on a message: the signature, and
 * whatever else a preference dialog comes to hold. One JSON entry per account,
 * refreshed and written through on every change so open windows preserve
 * each other's unrelated preferences.
 *
 * The store is a pure function over an injectable storage, like readstate.js
 * and drafts.js -- localStorage in the app, a Map in the tests. A
 * setting is a display or writing preference, so it never waits on the network
 * and never throws: a storage that refuses a write leaves the setting in
 * memory for the session, which is the most it can be.
 *
 * Every value is re-read defensively on the way out. A store this app does not
 * own the only copy of is a place where a field can come back as a number, an
 * object, or missing -- and `get` answers with the caller's fallback rather
 * than with whatever was found there.
 */
export function createSettings(scope, storage = window.localStorage) {
  const key = `puter-mail:settings:${scope}`;

  const load = () => {
    try {
      const value = JSON.parse(storage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };

  let values = load() ?? {};
  const pending = new Set();

  const persist = () => {
    try {
      storage.setItem(key, JSON.stringify(values));
      return true;
    } catch {
      return false;
    }
  };

  return {
    /**
     * The stored value where it has the fallback's type, else the fallback.
     * Typed by the fallback rather than by the store, so a caller asking for a
     * string never has to handle a number that a hand-edited entry put there.
     */
    get(name, fallback) {
      const value = values[name];
      if (value === undefined || value === null) return fallback;
      if (fallback !== undefined && typeof value !== typeof fallback) return fallback;
      return value;
    },

    /** Store a value. Returns whether the write went through. */
    set(name, value) {
      const latest = load();
      if (latest !== null) {
        // Replay local edits that could not be saved, including deletions,
        // over the latest preferences from other windows.
        for (const field of pending) {
          if (Object.hasOwn(values, field)) latest[field] = values[field];
          else delete latest[field];
        }
        values = latest;
      }
      if (value === undefined || value === null) delete values[name];
      else values[name] = value;
      pending.add(name);
      const saved = persist();
      if (saved) pending.clear();
      return saved;
    },
  };
}
