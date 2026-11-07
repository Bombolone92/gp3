import { MAX_IMAGE_SIZE, MAX_PAGES } from './core/document.js';
import { waitFor } from './lib/abort.js';

const makeCanvas = (width, height) => {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
const toBlob = (canvas, type, quality) =>
  canvas.convertToBlob
    ? canvas.convertToBlob({ type, quality })
    : new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Picture files as original bytes; PDF placement applies their EXIF orientation losslessly. */
export async function normalizeImageFiles(
  files,
  { maxPages = MAX_PAGES, lazy = false, signal } = {},
) {
  signal?.throwIfAborted();
  // Check the whole batch before allocating any file buffers.
  if (files.length > maxPages) throw new Error('Keep between 1 and 1,000 pages in the PDF.');
  if (files.some((file) => file.size > MAX_IMAGE_SIZE))
    throw new Error('Choose an image smaller than 20 MB.');
  const readers = files.map((file) => async () => {
    const bytes = await waitFor(() => file.arrayBuffer(), signal);
    signal?.throwIfAborted();
    return new Uint8Array(bytes);
  });
  // On-demand readers let a PDF batch embed and release one source before reading another.
  return lazy ? readers : Promise.all(readers.map((read) => read()));
}

/**
 * Picture decoding and encoding for file-size reduction, on the browser's canvas: PDF.js
 * renders a one-image PDF at the wanted size and the canvas encodes the pixels as JPEG.
 */
export function createImageCodec(loadPdf) {
  return {
    async render(pdfBytes, width, height, { signal } = {}) {
      signal?.throwIfAborted();
      const task = loadPdf(pdfBytes);
      try {
        const pdf = await task.promise;
        signal?.throwIfAborted();
        const page = await pdf.getPage(1);
        signal?.throwIfAborted();
        const canvas = makeCanvas(width, height);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        await page.render({
          canvasContext: context,
          viewport: page.getViewport({ scale: 1 }),
          background: 'rgba(0,0,0,0)',
        }).promise;
        signal?.throwIfAborted();
        return context.getImageData(0, 0, width, height);
      } finally {
        await task.destroy();
      }
    },
    async encodeJpeg({ data, width, height }, quality, { signal } = {}) {
      signal?.throwIfAborted();
      const canvas = makeCanvas(width, height);
      canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
      const blob = await toBlob(canvas, 'image/jpeg', quality);
      signal?.throwIfAborted();
      const bytes = await blob.arrayBuffer();
      signal?.throwIfAborted();
      return new Uint8Array(bytes);
    },
  };
}
