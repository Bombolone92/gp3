/** Worker that traces one image: { image, options, extra } in, the trace result out. */
import { traceImage } from './trace-core.js';

self.onmessage = (e) => {
  const { image, options, extra } = e.data;
  let last = 0;
  try {
    const result = traceImage(image, options, {
      ...extra,
      onProgress: (v) => {
        // Throttle progress messages to whole percents.
        const p = Math.floor(v * 100);
        if (p !== last) {
          last = p;
          self.postMessage({ progress: v });
        }
      },
    });
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: err?.message || String(err) });
  }
};
