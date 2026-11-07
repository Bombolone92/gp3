/** Minimal event emitter. on() returns an unsubscribe function. */
export class Emitter {
  #handlers = new Map();

  on(type, fn) {
    let set = this.#handlers.get(type);
    if (!set) this.#handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  off(type, fn) {
    this.#handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.#handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}
