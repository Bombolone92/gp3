/**
 * Rendered music beds for the page, cached by track id. Rendering runs in a
 * worker when the browser has one (a track takes about half a second of
 * math) and falls back to the main thread.
 */
import { renderMusic } from './music.js';
import { encodeWav } from './wav.js';

export const MUSIC_RATE = 44100;

const samples = new Map(); // id -> Promise<{ left, right, sampleRate }>
const blobs = new Map(); // id -> Promise<Blob>
let worker = null;
let nextReq = 1;
const waiting = new Map(); // req -> { resolve, reject }

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('../workers/music-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data?.req);
      if (!w) return;
      waiting.delete(e.data.req);
      if (e.data.error) w.reject(new Error(e.data.error));
      else w.resolve({ left: e.data.left, right: e.data.right, sampleRate: e.data.sampleRate });
    };
    worker.onerror = () => {
      // A worker that cannot start: finish the waiting renders here.
      worker = false;
      for (const [, w] of waiting) w.fallback();
      waiting.clear();
    };
  } catch {
    worker = false;
  }
  return worker;
}

/** Stereo samples for a track: Promise<{ left, right, sampleRate }>. */
export function musicSamples(id) {
  let p = samples.get(id);
  if (!p) {
    const local = () => renderMusic(id, MUSIC_RATE);
    const w = typeof Worker === 'function' ? getWorker() : false;
    p = w
      ? new Promise((resolve, reject) => {
        const req = nextReq++;
        waiting.set(req, { resolve, reject, fallback: () => { try { resolve(local()); } catch (err) { reject(err); } } });
        w.postMessage({ req, id, sampleRate: MUSIC_RATE });
      })
      : new Promise((resolve) => setTimeout(resolve, 0)).then(local);
    p.catch(() => samples.delete(id));
    samples.set(id, p);
  }
  return p;
}

/** The track as a 16-bit stereo WAV Blob. */
export function musicBlob(id) {
  let b = blobs.get(id);
  if (!b) {
    b = musicSamples(id).then((s) => encodeWav([s.left, s.right], s.sampleRate));
    b.catch(() => blobs.delete(id));
    blobs.set(id, b);
  }
  return b;
}

export function isRendered(id) {
  return samples.has(id);
}
