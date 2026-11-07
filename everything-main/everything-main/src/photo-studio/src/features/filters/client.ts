// Worker lanes. Each lane is one module worker running one job at a time;
// starting a job on a busy lane, or cancelling, terminates the worker (filters
// run synchronously inside it) and a fresh one reloads the sources it needs.
import { CancelledError } from '../../imaging/types';
import type { FromWorker, LoadMessage, ToWorker } from './protocol';

type Pending = { job: number; resolve: (m: Extract<FromWorker, { type: 'done' }>) => void; reject: (e: Error) => void; progress?: (f: number) => void };
const sources = new Map<string, LoadMessage>();
const lanes = new Set<Lane>();
let jobs = 0;

/** Make a region available to every lane under `key` (sent lazily). */
export function registerSource(msg: LoadMessage) {
  sources.set(msg.key, msg);
}
export function releaseSource(key: string) {
  sources.delete(key);
  for (const l of lanes) l.drop(key);
}

export class Lane {
  private worker?: Worker;
  private loaded = new Set<string>();
  private pending?: Pending;
  constructor(readonly name: string) {
    lanes.add(this);
  }
  get busy() {
    return !!this.pending;
  }
  private spawn() {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: `filters-${this.name}` });
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data,
        p = this.pending;
      if (!p || m.job !== p.job) return;
      if (m.type === 'progress') p.progress?.(m.value);
      else {
        this.pending = undefined;
        if (m.type === 'done') p.resolve(m);
        else p.reject(m.cancelled ? new CancelledError() : new Error(m.message));
      }
    };
    w.onerror = (ev) => {
      const p = this.pending;
      this.pending = undefined;
      this.kill();
      p?.reject(new Error(ev.message || 'The filter worker failed.'));
    };
    this.worker = w;
    this.loaded.clear();
    return w;
  }
  private kill() {
    this.worker?.terminate();
    this.worker = undefined;
    this.loaded.clear();
  }
  /** Run a job (its `job` field is assigned here). Any running job is cancelled. */
  run(msg: ToWorker & { job: number }, keys: string[], progress?: (f: number) => void): Promise<Extract<FromWorker, { type: 'done' }>> {
    if (this.pending) this.cancel();
    const w = this.worker ?? this.spawn();
    for (const k of keys) {
      if (this.loaded.has(k)) continue;
      const src = sources.get(k);
      if (!src) return Promise.reject(new Error('The filter source was released.'));
      w.postMessage(src);
      this.loaded.add(k);
    }
    msg.job = ++jobs;
    return new Promise((resolve, reject) => {
      this.pending = { job: msg.job, resolve, reject, progress };
      w.postMessage(msg);
    });
  }
  cancel() {
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      this.kill();
      p.reject(new CancelledError());
    }
  }
  drop(key: string) {
    if (this.loaded.delete(key)) this.worker?.postMessage({ type: 'drop', key } satisfies ToWorker);
  }
  dispose() {
    this.cancel();
    this.kill();
    lanes.delete(this);
  }
}
export const isCancel = (e: unknown) => e instanceof Error && e.name === 'CancelledError';
