/**
 * The trace service keeps trace objects up to date. It watches open
 * documents; when a trace object's options change (or a document opens
 * with stale results) it traces again after a short pause, in a worker,
 * cancelling any earlier job for the same object, and stores the result
 * in place. Progress is published as app events:
 *   app.emit('trace-progress', { doc, id, value })   value 0..1, or null when done
 */
import { normalizeOptions } from './presets.js';
import { tracePixels, runTrace } from './trace-runner.js';
import { isTrace, needsTrace, traceImageNode, traceKey, swatchColors, applyResult } from './trace-live.js';

/** Trace an image node with options. Resolves to a result carrying its key. */
export async function computeTrace(doc, img, options, { onProgress = null, signal = null } = {}) {
  const o = normalizeOptions(options);
  const { image, scale } = await tracePixels(doc, img.asset, o.detail);
  const swatches = o.mode === 'color' && o.palette === 'swatches' ? swatchColors(doc) : null;
  const result = await runTrace(image, o, { scale, swatches }, { onProgress, signal });
  return { key: traceKey(doc, img.asset, o), ...result };
}

export class TraceService {
  constructor(app, { delay = 280 } = {}) {
    this.app = app;
    this.delay = delay;
    this.jobs = new Map(); // `${docKey}:${id}` -> { controller, timer, value }
    this.watched = new WeakSet();
    this.docKeys = new WeakMap();
    this.nextKey = 0;
  }

  #key(doc, id) {
    let k = this.docKeys.get(doc);
    if (k == null) this.docKeys.set(doc, (k = ++this.nextKey));
    return `${k}:${id}`;
  }

  /** Start watching a document (idempotent) and refresh any stale trace objects in it. */
  watch(doc) {
    if (!doc || this.watched.has(doc)) return;
    this.watched.add(doc);
    doc.on('change', (e) => {
      if (!e?.commit || e.amend) return;
      if (e.ids?.has?.('root')) {
        this.scan(doc);
        return;
      }
      for (const id of e.ids || []) {
        let n = doc.get(id);
        // An edited source image refreshes its trace object.
        if (n && !isTrace(n) && n.parent) n = doc.get(n.parent);
        if (isTrace(n)) {
          if (needsTrace(doc, n)) this.schedule(doc, n.id);
          else this.cancel(doc, n.id);
        }
      }
    });
    this.scan(doc);
  }

  scan(doc) {
    doc.walk((n) => {
      if (isTrace(n) && needsTrace(doc, n)) this.schedule(doc, n.id, 0);
      return true;
    });
  }

  /** Progress (0..1) of the pending trace of an object, or null. */
  progress(doc, id) {
    const j = this.jobs.get(this.#key(doc, id));
    return j ? j.value : null;
  }

  /** True when a trace object shows a result traced with other options. */
  isStale(doc, node) {
    return needsTrace(doc, node);
  }

  isBusy(doc, id) {
    return this.jobs.has(this.#key(doc, id));
  }

  cancel(doc, id) {
    const key = this.#key(doc, id);
    const j = this.jobs.get(key);
    if (!j) return;
    clearTimeout(j.timer);
    j.controller?.abort();
    this.jobs.delete(key);
    this.app?.emit?.('trace-progress', { doc, id, value: null });
  }

  schedule(doc, id, delay = this.delay) {
    this.cancel(doc, id);
    const key = this.#key(doc, id);
    const job = { controller: null, timer: 0, value: 0 };
    this.jobs.set(key, job);
    this.app?.emit?.('trace-progress', { doc, id, value: 0 });
    job.timer = setTimeout(() => this.#run(doc, id, key, job), delay);
  }

  /** Trace now and wait for the result to be stored (resolves to true when stored). */
  async refresh(doc, id) {
    this.cancel(doc, id);
    const key = this.#key(doc, id);
    const job = { controller: null, timer: 0, value: 0 };
    this.jobs.set(key, job);
    return this.#run(doc, id, key, job);
  }

  async #run(doc, id, key, job) {
    const node = doc.get(id);
    const img = traceImageNode(doc, node);
    if (!img || !isTrace(node)) {
      this.jobs.delete(key);
      return false;
    }
    job.controller = new AbortController();
    const report = (v) => {
      job.value = v;
      this.app?.emit?.('trace-progress', { doc, id, value: v });
    };
    try {
      const result = await computeTrace(doc, img, node.live.options, { onProgress: report, signal: job.controller.signal });
      if (this.jobs.get(key) !== job) return false;
      // Wait for any open transaction (a drag in progress) before storing.
      let stored = applyResult(doc, id, result);
      for (let i = 0; !stored && doc.tx && i < 600; i++) {
        await new Promise((r) => setTimeout(r, 50));
        stored = applyResult(doc, id, result);
      }
      return stored;
    } catch (err) {
      if (err?.name !== 'AbortError' && this.jobs.get(key) === job) this.app?.notify?.(err?.message || 'The image could not be traced.', { error: true });
      return false;
    } finally {
      if (this.jobs.get(key) === job) {
        this.jobs.delete(key);
        this.app?.emit?.('trace-progress', { doc, id, value: null });
      }
    }
  }
}
