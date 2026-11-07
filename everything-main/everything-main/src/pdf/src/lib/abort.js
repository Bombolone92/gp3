/** Stop waiting promptly for work that has no cancellation API, and consume late results. */
export function waitFor(operation, signal) {
  if (!signal) return operation();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      signal.removeEventListener('abort', abort);
      settle(value);
    };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
  });
}
