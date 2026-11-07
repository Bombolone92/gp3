// Experimental transport retained only for source-contract benchmarks.
// Removed from production after reported loading failures; not live-verified.
/**
 * App-local range transport. The SDK sends byte_count/offset query params,
 * while current /read consumes HTTP Range (LegacyFSController.read). Send
 * both for compatibility, and reject oversized responses before parsing.
 * Other operations keep the SDK's permissions and retry behavior.
 */
export function createMailFS(puter, mailPath, { fetch: fetcher = globalThis.fetch } = {}) {
  const read = async (path, options) => {
    const count = options?.byte_count;
    if (!count) return puter.fs.read(path, options);
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(count) || count <= 0 || !Number.isSafeInteger(offset) || offset < 0
      || !Number.isSafeInteger(offset + count) || typeof path !== 'string'
      || !path.startsWith(`${mailPath}/`) || path.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('Invalid mailbox range');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const url = new URL(`${puter.APIOrigin.replace(/\/$/, '')}/read`);
      url.search = new URLSearchParams({ file: path, offset: String(offset), byte_count: String(count) });
      const response = await fetcher(url.href, {
        credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${puter.authToken}`, Range: `bytes=${offset}-${offset + count - 1}` },
      });
      if (!response.ok) {
        controller.abort();
        throw new Error(`Could not read message headers (${response.status}). Retry or sign in again.`);
      }
      const length = response.headers.get('Content-Length');
      const range = response.headers.get('Content-Range');
      const parsed = range && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      if ((length !== null && Number(length) > count)
        || (response.status === 206 && !parsed)
        || (range && (!parsed || Number(parsed[1]) !== offset
          || Number(parsed[2]) >= offset + count
          || (Number(parsed[2]) < offset + count - 1 && Number(parsed[2]) + 1 !== Number(parsed[3]))))) {
        controller.abort();
        throw new Error('The mail server did not honor the requested byte range');
      }
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > count) {
          await reader.cancel();
          controller.abort();
          throw new Error('The mail server did not honor the requested byte range');
        }
        chunks.push(value);
      }
      if (parsed && size !== Number(parsed[2]) - offset + 1) throw new Error('Incomplete message range. Please retry.');
      return new Blob(chunks);
    } finally {
      clearTimeout(timeout);
    }
  };
  return new Proxy(puter.fs, {
    get(target, key) {
      if (key === 'read') return read;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
