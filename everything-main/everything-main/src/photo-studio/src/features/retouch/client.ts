// Worker client with progress and cancellation for heavy retouching jobs, plus
// the status-bar progress indicator. Two channels keep interactive Quick
// Selection updates from queueing behind a long Context Fill.
import type { Editor } from '../../editor';
import { CancelledError } from '../../imaging/types';
import { escapeXML } from '../../model/assets';

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; progress?: (f: number) => void };
type Channel = 'heavy' | 'live';
class WorkerChannel {
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private next = 1;
  // Bumped whenever the worker is replaced, so stateful users can re-initialize.
  generation = 0;
  private get w() {
    if (!this.worker) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'retouch' });
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
        this.reset(new Error(ev.message || 'The image worker failed.'));
      };
      this.worker = w;
      this.generation++;
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
      this.w.postMessage({ id, op, args }, opts.transfer ?? []);
    });
  }
  /** Stop everything in flight (a synchronous job cannot be interrupted otherwise). */
  reset(reason: unknown = new CancelledError()) {
    this.worker?.terminate();
    this.worker = undefined;
    const list = [...this.pending.values()];
    this.pending.clear();
    for (const p of list) p.reject(reason);
  }
  get busy() {
    return this.pending.size > 0;
  }
}
const channels: Record<Channel, WorkerChannel> = { heavy: new WorkerChannel(), live: new WorkerChannel() };
export function channel(name: Channel) {
  return channels[name];
}

/** Buffers of typed arrays inside a value, for zero-copy transfer. Only pass
 * buffers the caller no longer needs. */
export function buffersOf(...values: unknown[]): Transferable[] {
  const out: Transferable[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (ArrayBuffer.isView(v)) {
      if (!out.includes(v.buffer as ArrayBuffer)) out.push(v.buffer as ArrayBuffer);
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  values.forEach(walk);
  return out;
}

export type Job = { progress: (f: number) => void; signal: AbortSignal };
/** Run a job with a status-bar progress indicator (shown after a short delay so
 * quick jobs do not flicker) and a Cancel button. Resolves to undefined when
 * cancelled. */
export async function withProgress<T>(e: Editor, label: string, run: (job: Job) => Promise<T>): Promise<T | undefined> {
  const ctrl = new AbortController();
  const bar = document.createElement('span');
  bar.className = 'retouch-progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  bar.innerHTML = `<span class="retouch-progress-label">${escapeXML(label)}</span><span class="retouch-progress-track"><span class="retouch-progress-fill"></span></span><button type="button" class="retouch-progress-cancel">Cancel</button>`;
  const fill = bar.querySelector<HTMLElement>('.retouch-progress-fill')!;
  bar.querySelector('button')!.addEventListener('click', () => ctrl.abort());
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') ctrl.abort();
  };
  let indeterminate = true;
  bar.classList.add('indeterminate');
  const timer = window.setTimeout(() => {
    const status = e.root.querySelector('#status');
    status?.parentElement?.insertBefore(bar, status);
    document.addEventListener('keydown', onKey, true);
  }, 150);
  try {
    return await run({
      signal: ctrl.signal,
      progress: (f) => {
        if (indeterminate) {
          indeterminate = false;
          bar.classList.remove('indeterminate');
        }
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
      },
    });
  } catch (error) {
    if (error instanceof CancelledError || ctrl.signal.aborted) {
      e.message(`${label} cancelled.`);
      return undefined;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    bar.remove();
    document.removeEventListener('keydown', onKey, true);
  }
}
/** Shorthand: run one heavy worker job under a progress indicator. `args`
 * may be a function so slow reads (the merged image) happen under the indicator
 * too; typed-array buffers in the arguments are transferred. */
export function heavy<T>(e: Editor, label: string, op: string, args: Record<string, unknown> | (() => Promise<Record<string, unknown>>), transfer?: Transferable[]) {
  return withProgress(e, label, async (job) => {
    const a = typeof args === 'function' ? await args() : args;
    if (job.signal.aborted) throw new CancelledError();
    return channels.heavy.call<T>(op, a, { transfer: transfer ?? buffersOf(a), progress: job.progress, signal: job.signal });
  });
}
