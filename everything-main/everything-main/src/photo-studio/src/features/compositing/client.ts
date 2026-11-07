// Main-thread side of the compositing worker. Long jobs show the shared
// status-bar progress indicator with Cancel; previews use a second worker so
// they never queue behind a long merge.
import type { Editor } from '../../editor';
import { CancelledError } from '../../imaging/types';
import { buffersOf, withProgress, type Job } from '../retouch/client';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: (f: number) => void };

class Channel {
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private next = 1;
  private get w() {
    if (!this.worker) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'compositing' });
      w.onmessage = (ev: MessageEvent<{ id: number; result?: unknown; error?: string; progress?: number }>) => {
        const p = this.pending.get(ev.data.id);
        if (!p) return;
        if (ev.data.progress !== undefined && !('result' in ev.data) && !ev.data.error) {
          p.progress?.(ev.data.progress);
          return;
        }
        this.pending.delete(ev.data.id);
        if (ev.data.error) p.reject(new Error(ev.data.error));
        else p.resolve(ev.data.result);
      };
      w.onerror = (ev) => {
        ev.preventDefault();
        this.reset(new Error(ev.message || 'The compositing worker failed.'));
      };
      this.worker = w;
    }
    return this.worker;
  }
  call<T>(op: string, args: Record<string, unknown>, opts: { transfer?: Transferable[]; progress?: (f: number) => void; signal?: AbortSignal } = {}): Promise<T> {
    if (opts.signal?.aborted) return Promise.reject(new CancelledError());
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress: opts.progress });
      opts.signal?.addEventListener('abort', () => {
        if (this.pending.has(id)) this.reset(new CancelledError());
      });
      this.w.postMessage({ id, op, args }, opts.transfer ?? buffersOf(args));
    });
  }
  reset(reason: unknown = new CancelledError()) {
    this.worker?.terminate();
    this.worker = undefined;
    const list = [...this.pending.values()];
    this.pending.clear();
    for (const p of list) p.reject(reason);
  }
}

export const heavyChannel = new Channel();
export const previewChannel = new Channel();

/** One job on the heavy worker inside an existing progress scope. Typed
 * arrays in `args` are transferred, so pass copies the caller can lose. */
export function runJob<T>(job: Job | undefined, op: string, args: Record<string, unknown>, range: [number, number] = [0, 1]) {
  return heavyChannel.call<T>(op, args, {
    signal: job?.signal,
    progress: job ? (f) => job.progress(range[0] + (range[1] - range[0]) * f) : undefined,
  });
}

/** Run a multi-step task with the status-bar progress indicator. */
export function withTask<T>(e: Editor, label: string, run: (job: Job) => Promise<T>) {
  return withProgress(e, label, run);
}

/** A latest-wins preview job: older pending previews are cancelled. */
export function previewJob<T>(op: string, args: Record<string, unknown>) {
  return previewChannel.call<T>(op, args);
}

export { CancelledError };
