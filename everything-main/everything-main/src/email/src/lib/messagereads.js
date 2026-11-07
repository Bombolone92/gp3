/**
 * Session-local reads of immutable delivered messages. Rows, search and
 * threading share in-flight header requests; reopening a message reuses its
 * original bytes. No remote cache or KV requests are involved.
 */
export function createMessageReads(fs, { maxBytes = 16 * 1024 * 1024, maxEntries = 32,
  maxHeadBytes = 1024 * 1024, maxHeadEntries = 128, concurrency = 12 } = {}) {
  const pending = new Map();
  const bodies = new Map();
  const heads = new Map();
  let bytes = 0;
  let headBytes = 0;
  let running = 0;
  const queue = [];
  const pump = () => {
    while (running < concurrency && queue.length) {
      const job = queue.shift();
      running++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  };
  const schedule = (run, foreground) => new Promise((resolve, reject) => {
    const job = { run, resolve, reject };
    if (foreground) queue.unshift(job);
    else queue.push(job);
    pump();
  });

  const drop = (path) => {
    const blob = bodies.get(path);
    if (!blob) return;
    bodies.delete(path);
    bytes -= blob.size;
  };

  const read = (path, options) => {
    const count = options?.byte_count;
    const offset = options?.offset ?? 0;
    const cache = bodies.has(path) ? bodies : heads;
    const cached = cache.get(path);
    if (cached) {
      cache.delete(path);
      cache.set(path, cached);
      return Promise.resolve(count ? cached.slice(offset, offset + count) : cached);
    }
    const key = JSON.stringify([path, offset, count ?? null]);
    if (pending.has(key)) return pending.get(key).promise;
    const request = { path };
    request.promise = schedule(() => fs.read(path, options), !count).then((blob) => {
      // Invalidated reads may still finish for their callers, but must never
      // repopulate the cache. Oversized messages are returned without keeping
      // them or evicting all of the smaller messages the reader just opened.
      if (!offset && !count && pending.get(key) === request && blob.size <= maxBytes && maxEntries > 0) {
        drop(path);
        while (bodies.size && (bytes + blob.size > maxBytes || bodies.size >= maxEntries)) {
          drop(bodies.keys().next().value);
        }
        bodies.set(path, blob);
        bytes += blob.size;
      }
      // A short range reached EOF: it already contains the entire message.
      // Keep these separately so background indexing cannot evict open bodies.
      // Equality is deliberately excluded: a full range proves nothing about EOF.
      if (!offset && count && blob.size < count && blob.size <= maxHeadBytes
        && maxHeadEntries > 0 && pending.get(key) === request) {
        if (heads.has(path)) { headBytes -= heads.get(path).size; heads.delete(path); }
        while (heads.size && (headBytes + blob.size > maxHeadBytes || heads.size >= maxHeadEntries)) {
          const oldest = heads.keys().next().value;
          headBytes -= heads.get(oldest).size;
          heads.delete(oldest);
        }
        heads.set(path, blob);
        headBytes += blob.size;
      }
      return blob;
    }).finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    return request.promise;
  };

  // Also accepts a directory prefix, for folder events and manual refresh.
  const forget = (prefix = '') => {
    const matches = (path) => !prefix || path === prefix || path.startsWith(`${prefix}/`);
    for (const path of bodies.keys()) if (matches(path)) drop(path);
    for (const [path, blob] of heads) if (matches(path)) { heads.delete(path); headBytes -= blob.size; }
    for (const [key, request] of pending) if (matches(request.path)) pending.delete(key);
  };

  // A partial header range is not enough to open a reader without another
  // download. This probe never fetches, retains bytes, or changes LRU order.
  const hasComplete = (path) => bodies.has(path) || heads.has(path);
  return { read, forget, hasComplete };
}
