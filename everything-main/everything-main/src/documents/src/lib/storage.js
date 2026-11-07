/** Browser policy can deny the storage getter itself, before any read or write. */
export function localStore() {
  try { return globalThis.localStorage || null; } catch { return null; }
}
