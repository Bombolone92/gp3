import { decodeTiff } from './tiff.js';

// A malformed compressed image must not block the editor's main thread.
self.onmessage = async ({ data }) => {
  try {
    const result = await decodeTiff(data);
    self.postMessage(result, [result.pixels.buffer]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
