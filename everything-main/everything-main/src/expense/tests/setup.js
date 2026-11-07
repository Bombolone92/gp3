// jsdom lacks matchMedia; the theme module and modal use it defensively.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}
if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = () => 'blob:mock';
  globalThis.URL.revokeObjectURL = () => {};
}

// Node 22+ exposes a localStorage global that is not functional without a
// backing file; give the theme module a plain in-memory Storage instead.
if (typeof globalThis.localStorage?.getItem !== 'function') {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}
