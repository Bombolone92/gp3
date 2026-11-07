/**
 * Test environment fix-ups, run before every suite.
 *
 * Node 22+ ships a `globalThis.localStorage` of its own, and without a
 * `--localstorage-file` it is an object with no methods on it at all. Vitest's
 * happy-dom environment only copies a window property onto the global when the
 * global does not already have one, so under a current Node the DOM's Storage
 * never arrives and `localStorage.setItem` is undefined. The app is defensive
 * about a broken storage and carries on without it -- which is exactly what
 * made this hard to spot: only the suites that *clear* storage between cases
 * failed, while the rest quietly ran without the caches they were testing.
 *
 * Where the global is not a working Storage, one is put in its place.
 */

const working = (storage) => Boolean(storage)
  && typeof storage.getItem === 'function'
  && typeof storage.setItem === 'function'
  && typeof storage.removeItem === 'function'
  && typeof storage.clear === 'function';

const makeStorage = () => {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(String(key)) ? data.get(String(key)) : null),
    setItem: (key, value) => { data.set(String(key), String(value)); },
    removeItem: (key) => { data.delete(String(key)); },
    clear: () => { data.clear(); },
  };
};

for (const name of ['localStorage', 'sessionStorage']) {
  let current;
  try {
    current = globalThis[name];
  } catch {
    current = null;
  }
  if (working(current)) continue;
  const storage = makeStorage();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    get: () => storage,
    set: () => {},
  });
}
