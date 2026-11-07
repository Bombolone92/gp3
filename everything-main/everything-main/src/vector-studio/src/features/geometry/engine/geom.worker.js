/** Worker that runs large geometry jobs on the same compiled wasm module. */
import { GeomInstance } from './wasm.js';

let inst = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    inst = new GeomInstance(msg.module);
    return;
  }
  if (msg.type === 'run') {
    try {
      if (!inst) throw new Error('The geometry engine is not ready.');
      const result = inst.runRaw(msg.op, msg.input, msg.tol);
      self.postMessage({ id: msg.id, result }, [result.buffer]);
    } catch (err) {
      self.postMessage({ id: msg.id, error: err?.message || String(err) });
    }
  }
};
