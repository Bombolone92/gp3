import { tiffDirectory } from './tiff.js';
const timeoutMs = 15000;
export function tiffWorker(bytes) {
  // Preflight dimensions, directories, offsets and decoded size before even
  // starting the worker. Its deadline also bounds malformed codec execution.
  tiffDirectory(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' });
    const finish = (error, result) => { clearTimeout(timer); worker.terminate(); if (error) reject(error); else resolve(result); };
    const timer = setTimeout(() => finish(new Error('TIFF picture decoding timed out.')), timeoutMs);
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data);
    worker.onerror = () => finish(new Error('The TIFF picture could not be decoded.'));
    // A view into the whole package would be cloned buffer and all; an exact copy is handed over instead.
    const copy = new Uint8Array(bytes);
    worker.postMessage(copy, [copy.buffer]);
  });
}
