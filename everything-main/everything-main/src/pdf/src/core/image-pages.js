/**
 * Pictures as pages: each PNG or JPEG is fitted onto a sheet of paper turned to match it, so
 * photos and scans become a PDF, or join an existing one after a chosen page.
 */
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import {
  embedOrientedImage,
  drawOrientedImage,
  ownGeometry,
  MAX_PAGES,
  MAX_FILE_SIZE,
} from './document.js';
import { stabilizeLocalDestinations } from './destinations.js';
import { shiftPageLabels } from './page-labels.js';
import { waitFor } from '../lib/abort.js';

/** Paper sizes in points. */
export const PAPER_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'CR', 'PA', 'DO']);
/** Letter in the regions that print on it, A4 everywhere else. */
export function defaultPaper(locale = globalThis.navigator?.language) {
  let region;
  try {
    region = new Intl.Locale(locale).maximize().region;
  } catch {
    region = undefined;
  }
  return LETTER_REGIONS.has(region) ? 'letter' : 'a4';
}

export { jpegOrientation } from './image-orientation.js';

/**
 * Add one page per picture after page `after` (-1 for the front), each a sheet of `paper`
 * turned to match the picture, with the picture fitted and centered. Pictures may be bytes
 * or on-demand byte readers. Returns the new indices.
 */
export async function addImagePages(
  doc,
  images,
  { after = doc.getPageCount() - 1, paper = 'a4', signal } = {},
) {
  signal?.throwIfAborted();
  const size = PAPER_SIZES[paper];
  if (!size) throw new Error('Choose a paper size.');
  if (!images?.length) throw new Error('Choose at least one PNG or JPEG picture.');
  if (doc.getPageCount() + images.length > MAX_PAGES)
    throw new Error('Keep between 1 and 1,000 pages in the PDF.');
  stabilizeLocalDestinations(doc);
  const position = Math.min(Math.max(after + 1, 0), doc.getPageCount());
  const indices = [];
  let imageBytes = 0;
  for (const [k, source] of images.entries()) {
    const bytes = typeof source === 'function' ? await waitFor(source, signal) : source;
    const image = await waitFor(() => embedOrientedImage(doc, bytes), signal);
    // Store this image now so its decoded PNG channels can be freed before the next one.
    await waitFor(() => image.image.embed(), signal);
    // Encoded image streams survive serialization unchanged. This lower bound stops an
    // impossible batch before reading more sources or allocating an oversized output PDF.
    // Count new payloads only; source metadata may be discarded, and existing PDF streams
    // may be replaced during an edit. The final document size check remains authoritative.
    const stream = doc.context.lookup(image.image.ref);
    if (stream instanceof PDFRawStream) {
      imageBytes += stream.getContentsSize();
      const mask = stream.dict.lookup(PDFName.of('SMask'));
      if (mask instanceof PDFRawStream) imageBytes += mask.getContentsSize();
    }
    if (imageBytes >= MAX_FILE_SIZE)
      throw new Error('These pictures would exceed the 100 MB PDF limit. Choose fewer pictures.');
    const [width, height] = image.width > image.height ? [size[1], size[0]] : size;
    const scale = Math.min(width / image.width, height / image.height);
    const fitted = { width: image.width * scale, height: image.height * scale };
    const page = ownGeometry(doc.insertPage(position + k, [width, height]));
    drawOrientedImage(page, image, {
      x: (width - fitted.width) / 2,
      y: (height - fitted.height) / 2,
      width: fitted.width,
      height: fitted.height,
    });
    indices.push(position + k);
  }
  shiftPageLabels(doc, position, indices.length);
  return indices;
}

/** A new PDF whose pages are the given pictures, in order. */
export async function imagesToPdf(images, options = {}) {
  const doc = await PDFDocument.create();
  await addImagePages(doc, images, { ...options, after: -1 });
  return waitFor(() => doc.save(), options.signal);
}
