export const checkAbort = (signal) => {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError');
};

// Puter's SDK cannot abort a request already on the wire. Stop scheduling the
// next page once every consumer has left; one consumer never cancels another.
export function sharedTask(run) {
  let current = null;
  return ({ signal, onProgress } = {}) => {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    if (!current) {
      const task = { controller: new AbortController(), consumers: new Set() };
      current = task;
      task.promise = Promise.resolve().then(() => run(task.controller.signal, value => {
        for (const consumer of task.consumers) consumer.onProgress?.(value);
      })).finally(() => { if (current === task) current = null; });
    }
    const task = current;
    return new Promise((resolve, reject) => {
      const consumer = { onProgress };
      task.consumers.add(consumer);
      const cleanup = () => {
        signal?.removeEventListener('abort', abort);
        task.consumers.delete(consumer);
      };
      const abort = () => {
        cleanup();
        reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
        if (!task.consumers.size) {
          task.controller.abort();
          if (current === task) current = null;
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      task.promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  };
}

export const yieldTask = () => globalThis.scheduler?.yield
  ? globalThis.scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
