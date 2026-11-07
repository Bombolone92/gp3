/**
 * Geometry engine front end. The wasm module is fetched and compiled once,
 * lazily, on first use. Small jobs run synchronously on the main thread;
 * big ones (which can take longer than a frame or two) run in a worker that
 * instantiates the same compiled module, so the UI stays responsive.
 */
import { encode, decode, jobSize, OP } from './codec.js';
import { GeomInstance } from './wasm.js';

export { OP };

/** Anchor count above which a job goes to the worker. */
export const WORKER_THRESHOLD = 600;
/** Default flattening tolerance in document units (points). */
export const DEFAULT_TOL = 0.02;

let modulePromise = null;
let mainInstance = null;
let worker = null;
let workerFailed = false;
let seq = 0;
const pending = new Map();

/** Override how the module bytes are obtained (tests pass bytes read from disk). */
let sourceOverride = null;
export function setGeomSource(bytesOrModule) {
  sourceOverride = bytesOrModule;
  modulePromise = null;
  mainInstance = null;
}

async function compile() {
  if (sourceOverride) return sourceOverride instanceof WebAssembly.Module ? sourceOverride : WebAssembly.compile(sourceOverride);
  const url = new URL('../../../wasm/geom.wasm', import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load the geometry engine.');
  if (WebAssembly.compileStreaming && (res.headers.get('content-type') || '').includes('wasm')) {
    try {
      return await WebAssembly.compileStreaming(res.clone());
    } catch {
      // Fall back to compiling the bytes (wrong MIME type on some static hosts).
    }
  }
  return WebAssembly.compile(await res.arrayBuffer());
}

/** Load the engine (once). Resolves to the main-thread instance. */
export function loadGeom() {
  if (!modulePromise) {
    modulePromise = compile().then((m) => {
      mainInstance = new GeomInstance(m);
      return m;
    });
    modulePromise.catch(() => {
      modulePromise = null;
    });
  }
  return modulePromise.then(() => mainInstance);
}

/** The main-thread instance when already loaded, else null (for synchronous hover paths). */
export function geomIfLoaded() {
  return mainInstance;
}

function getWorker(module) {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./geom.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const { id, result, error } = e.data;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (error) p.reject(new Error(error));
        else p.resolve(result);
      };
      worker.onerror = () => {
        workerFailed = true;
        for (const p of pending.values()) p.reject(new Error('worker-failed'));
        pending.clear();
        worker?.terminate();
        worker = null;
      };
      worker.postMessage({ type: 'init', module });
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return worker;
}

/**
 * Run an op. Returns decoded records. `opts.worker`: true forces the worker,
 * false forces the main thread; by default jobs above WORKER_THRESHOLD
 * anchors go to the worker.
 */
export async function runGeom(op, shapes, params = [], opts = {}) {
  const tol = opts.tol ?? DEFAULT_TOL;
  const inst = await loadGeom();
  const big = opts.worker ?? jobSize(shapes) > WORKER_THRESHOLD;
  if (big) {
    const module = await modulePromise;
    const w = getWorker(module);
    if (w) {
      const input = encode(shapes, params);
      const id = ++seq;
      try {
        const result = await new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          w.postMessage({ type: 'run', id, op, input, tol }, [input.buffer]);
        });
        return decode(result);
      } catch (err) {
        if (err.message !== 'worker-failed') throw err;
      }
    }
  }
  return inst.run(op, shapes, params, tol);
}

/** Synchronous run on the main thread (engine must be loaded). */
export function runGeomSync(op, shapes, params = [], tol = DEFAULT_TOL) {
  if (!mainInstance) throw new Error('The geometry engine is not loaded yet.');
  return mainInstance.run(op, shapes, params, tol);
}
