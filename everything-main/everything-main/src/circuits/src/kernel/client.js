// Promise API over the kernel worker. Documents are encoded here into flat
// buffers that are transferred (not copied) to the worker, which keeps big
// boards cheap to send, and the answers are decoded back into plain objects.
//
//   const kernel = new KernelClient();
//   const fills = await kernel.pours(boardDoc, library);          // Map<pourId, PolygonSet>
//   const issues = await kernel.drc(boardDoc, library, { pourFills: fills });
//   const routes = await kernel.autoroute(boardDoc, library, { nets }, (p) => show(p.done, p.total));

import {
  encodePours, decodePours, encodeDrc, decodeDrc, ruleChecks, encodeRoute, decodeRoute, createKernel,
} from './ops.js';

export { createKernel };

export class KernelCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

export class KernelClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.fallback = null;
  }

  _spawn() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const { id, result, error, progress } = e.data || {};
      const job = this.pending.get(id);
      if (!job) return;
      if (progress) { job.onProgress?.(progress); return; }
      this.pending.delete(id);
      if (error) job.reject(new Error(error)); else job.resolve(result);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The geometry kernel stopped unexpectedly');
      for (const job of this.pending.values()) job.reject(err);
      this.pending.clear();
      this.worker?.terminate();
      this.worker = null;
    };
    return this.worker;
  }

  async _inProcess() {
    if (!this.fallback) {
      this.fallback = fetch(new URL('./kernel.wasm', import.meta.url)).then((r) => createKernel(r));
    }
    return this.fallback;
  }

  _call(op, input, opts = {}, onProgress = null) {
    if (typeof Worker === 'undefined') return null;
    const worker = this._spawn();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, op, input, opts }, [input.buffer]);
    });
  }

  async pours(doc, library, opts = {}) {
    const ctx = encodePours(doc, library, opts);
    const call = this._call('pours', ctx.input);
    if (!call) return (await this._inProcess()).pours(doc, library, opts);
    return decodePours(await call, ctx);
  }

  async drc(doc, library, opts = {}) {
    const ctx = encodeDrc(doc, library, opts);
    const call = this._call('drc', ctx.input);
    if (!call) return (await this._inProcess()).drc(doc, library, opts);
    const geometric = decodeDrc(await call, ctx);
    return [...ruleChecks(doc, library), ...geometric];
  }

  async autoroute(doc, library, opts = {}, onProgress = null) {
    const ctx = encodeRoute(doc, library, opts);
    const call = this._call('route', ctx.input, { timeLimitMs: opts.timeLimitMs ?? 20000 }, onProgress);
    if (!call) return (await this._inProcess()).autoroute(doc, library, opts, onProgress);
    const { out, timedOut } = await call;
    return { ...decodeRoute(out, ctx), timedOut };
  }

  /** Stops whatever is running. Pending calls reject with an AbortError. */
  cancel() {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    const err = new KernelCancelled();
    for (const job of this.pending.values()) job.reject(err);
    this.pending.clear();
  }

  dispose() {
    this.cancel();
    this.fallback = null;
  }
}
