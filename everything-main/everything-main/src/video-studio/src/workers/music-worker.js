/** Renders music beds off the main thread (see media/music.js). */
import { renderMusic } from '../media/music.js';

self.onmessage = (e) => {
  const { req, id, sampleRate } = e.data || {};
  try {
    const r = renderMusic(id, sampleRate);
    self.postMessage({ req, left: r.left, right: r.right, sampleRate: r.sampleRate }, [r.left.buffer, r.right.buffer]);
  } catch (err) {
    self.postMessage({ req, error: err?.message || 'Could not render the music.' });
  }
};
