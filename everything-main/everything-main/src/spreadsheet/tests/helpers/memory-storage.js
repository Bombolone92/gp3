/** An in-memory Web Storage for tests: Node's own storage can shadow jsdom's and lacks clear(). */
export function memoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
    keys: () => [...data.keys()],
  };
}
