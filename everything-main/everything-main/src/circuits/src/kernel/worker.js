// Runs the geometry kernel off the main thread. Requests carry an encoded
// f64 buffer (see ops.js); answers come back as transferred buffers.
//   in:  { id, op: 'pours' | 'drc' | 'route', input: Float64Array, opts }
//   out: { id, result } | { id, error } | { id, progress }

import { instantiate, runRoute } from './ops.js';

let kernel = null;

async function load() {
  if (kernel) return kernel;
  const url = new URL('./kernel.wasm', import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the geometry kernel (${res.status})`);
  let module;
  try {
    module = await WebAssembly.compileStreaming(res.clone());
  } catch {
    // Servers that send the wrong content type: compile from bytes instead.
    module = await WebAssembly.compile(await res.arrayBuffer());
  }
  kernel = await instantiate(module);
  return kernel;
}

self.onmessage = async (event) => {
  const { id, op, input, opts = {} } = event.data || {};
  try {
    const raw = await load();
    if (op === 'pours' || op === 'drc') {
      const result = op === 'pours' ? raw.pours(input) : raw.drc(input);
      self.postMessage({ id, result }, [result.buffer]);
    } else if (op === 'route') {
      const { out, timedOut } = runRoute(raw, input, {
        timeLimitMs: opts.timeLimitMs ?? 20000,
        onProgress: (progress) => self.postMessage({ id, progress }),
      });
      self.postMessage({ id, result: { out, timedOut } }, [out.buffer]);
    } else if (op === 'ping') {
      self.postMessage({ id, result: true });
    } else {
      throw new Error(`Unknown kernel operation: ${op}`);
    }
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
