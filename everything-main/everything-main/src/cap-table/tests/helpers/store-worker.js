import { parentPort } from 'node:worker_threads';
import { Store } from '../../src/lib/store.js';

let sequence = 0;
const pending = new Map();
const call = (method, args) => new Promise((resolve, reject) => {
  const request = ++sequence;
  pending.set(request, { resolve, reject });
  parentPort.postMessage({ type: 'kv', request, method, args });
});
globalThis.puter = {
  kv: Object.fromEntries(['get', 'set', 'add', 'del'].map((method) => [method, (...args) => call(method, args)])),
  auth: { getUser: async () => ({ uuid: 'test', username: 'test' }) },
};
const store = new Store();
parentPort.on('message', async (message) => {
  if (message.type === 'reply') {
    const result = pending.get(message.request);
    pending.delete(message.request);
    if (message.error) result.reject(new Error(message.error));
    else result.resolve(message.value);
  } else if (message.type === 'save') {
    try {
      await store.addStakeholder({ name: message.name });
      parentPort.postMessage({ type: 'result', success: true, name: message.name });
    } catch (err) {
      parentPort.postMessage({ type: 'result', success: false, error: err.name, stale: store.isStale });
    }
  }
});
try {
  await store.init();
  parentPort.postMessage({ type: 'ready' });
} catch (err) {
  parentPort.postMessage({ type: 'failed', error: err.message });
}
