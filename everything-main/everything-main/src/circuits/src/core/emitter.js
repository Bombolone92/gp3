/** Minimal synchronous event emitter. `on` returns an unsubscribe function. */
export class Emitter {
  #handlers = new Map();

  on(type, fn) {
    let set = this.#handlers.get(type);
    if (!set) this.#handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(type, payload) {
    const set = this.#handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}

let counter = 0;
/** Short unique ids: time-ordered, collision resistant within and across sessions. */
export function uid(prefix = '') {
  counter = (counter + 1) % 0x10000;
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
