/**
 * Raw-export WebAssembly wrapper for the geometry engine. No bindings
 * generator: inputs are copied into linear memory as one f64 buffer and the
 * result is copied out of the engine's output buffer.
 */
import { encode, decode } from './codec.js';

export class GeomInstance {
  /** @param {WebAssembly.Module} module */
  constructor(module) {
    this.module = module;
    this.#instantiate();
  }

  #instantiate() {
    this.instance = new WebAssembly.Instance(this.module, {});
    this.exports = this.instance.exports;
  }

  /** Run an op on an already-encoded input buffer; returns the raw result buffer (a copy). */
  runRaw(op, input, tol = 0.01) {
    const ex = this.exports;
    const n = input.length;
    let ptr = 0;
    try {
      ptr = ex.geom_alloc(n);
      new Float64Array(ex.memory.buffer, ptr, n).set(input);
      const status = ex.geom_run(op, ptr, n, tol);
      if (status !== 0) throw new Error('The geometry engine rejected the input.');
      const optr = ex.geom_out_ptr();
      const olen = ex.geom_out_len();
      const out = new Float64Array(olen);
      out.set(new Float64Array(ex.memory.buffer, optr, olen));
      ex.geom_free(ptr, n);
      return out;
    } catch (err) {
      // A trap can leave the allocator inconsistent: start over with a fresh instance.
      this.#instantiate();
      throw err instanceof WebAssembly.RuntimeError ? new Error('The geometry engine could not process these shapes.') : err;
    }
  }

  /** Encode, run and decode. */
  run(op, shapes, params = [], tol = 0.01) {
    return decode(this.runRaw(op, encode(shapes, params), tol));
  }
}

/** Compile the engine from bytes (tests, worker fallback). */
export function geomFromBytes(bytes) {
  return new GeomInstance(new WebAssembly.Module(bytes));
}
