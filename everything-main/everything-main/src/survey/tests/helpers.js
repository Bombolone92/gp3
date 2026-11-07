import { instantiateWorker } from '../src/data/local-worker.js';
import { createLocalKv } from '../src/data/local-kv.js';
import { buildWorkerSource } from '../src/data/worker-source.js';
import { sha256Hex } from '../src/data/collector-client.js';

export const SECRET = 'a'.repeat(64);

/** A live collector worker over an in-memory KV, plus a fetch for it. */
export async function makeWorker() {
  const kv = createLocalKv();
  const source = buildWorkerSource(await sha256Hex(SECRET));
  const worker = instantiateWorker(source, { kv });
  const call = async (method, path, { body, admin = false, raw } = {}) => {
    const headers = {};
    if (admin) headers.authorization = `Bearer ${SECRET}`;
    const res = await worker.handle(`https://sv-test.puter.work${path}`, {
      method,
      headers,
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };
  const fetchFn = (url, init) => worker.handle(String(url), init);
  return { kv, call, fetchFn, worker, source };
}
