/**
 * The collector worker's deployable source: the shared runtime (validation
 * and logic, with its `export` keywords removed) followed by the worker
 * routes, with the admin secret hash and version filled in.
 */
import runtimeSource from '../shared/runtime.js?raw';
import collectorSource from '../worker/collector.js?raw';

import { WORKER_VERSION } from './worker-version.js';

export { WORKER_VERSION };

export function stripExports(src) {
  return src.replace(/^export\s+(?=(async\s+)?function|const|let|class)/gm, '');
}

export function buildWorkerSource(secretHash, { runtime = runtimeSource, collector = collectorSource } = {}) {
  return `${stripExports(runtime)}\n\n${collector}`
    .replace('__SV_ADMIN_SECRET_HASH__', secretHash)
    .replace('__SV_WORKER_VERSION__', WORKER_VERSION);
}
