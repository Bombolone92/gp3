/** Load the original canvas engine only when a document is opened. */
let pending = null;

export function loadEngine() {
  if (!pending) {
    pending = import('./engine-chunk.js').catch((e) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}
