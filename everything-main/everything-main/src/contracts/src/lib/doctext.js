/**
 * Reading text out of a document, whatever shape it arrives in.
 *
 * Real contracts are PDFs — often signed, sometimes scanned — and everything
 * downstream of an attachment used to treat them as opaque, so the marquee
 * feature (obligation extraction) was reachable only by opening the PDF
 * somewhere else and pasting. This turns a document into a string:
 *
 *   text/plain, .txt, .md   read directly
 *   application/pdf         text layer via pdf.js, loaded lazily
 *   scanned PDF or image    OCR via puter.ai.img2txt, with consent
 *
 * `extract.js` still takes a string; nothing about the extraction contract
 * changes. The result says which path was taken, because OCR output is
 * materially less reliable and that changes how closely a user should read
 * the suggestions.
 */

import { MAX_EXTRACT_CHARS } from './extract.js';

/** Below this many characters per page, a PDF's "text layer" is decoration. */
const TEXT_LAYER_MIN_CHARS = 40;

/** OCR is slow and costs an AI call per page; enough pages to find the terms. */
const MAX_OCR_PAGES = 10;

export function isTextDoc(doc) {
  return /^text\//.test(doc?.mime || '') || /\.(txt|md|markdown|csv)$/i.test(doc?.name || '');
}

export function isPdfDoc(doc) {
  return doc?.mime === 'application/pdf' || /\.pdf$/i.test(doc?.name || '');
}

export function isImageDoc(doc) {
  return /^image\//.test(doc?.mime || '') || /\.(png|jpe?g|webp|gif|tiff?|heic)$/i.test(doc?.name || '');
}

/** Whether this document can be turned into text at all. */
export function isReadableDoc(doc) {
  return isTextDoc(doc) || isPdfDoc(doc) || isImageDoc(doc);
}

/** Whether reading this document will need OCR, and so an AI round trip. */
export function willNeedOcr(doc) {
  // A PDF only needs OCR when its text layer turns out to be empty, which is
  // not knowable until it has been opened.
  return isImageDoc(doc);
}

/* ------------------------------------------------------------------ */
/* pdf.js, lazily                                                      */
/* ------------------------------------------------------------------ */

let pdfjsPromise = null;

/**
 * pdf.js is ~400 kB and most sessions never open a PDF, so it is loaded on
 * first use and never from the boot path.
 */
export function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const [pdfjs, workerUrl] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((m) => m.default),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  })().catch((err) => {
    // Let a later attempt retry rather than caching the failure forever.
    pdfjsPromise = null;
    throw err;
  });
  return pdfjsPromise;
}

/** An open pdf.js document, for text or for rendering pages. */
export async function openPdf(blob) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

/**
 * Release a document opened with openPdf — its worker thread included.
 *
 * Every getDocument() starts a worker of its own, and the proxy it resolves to
 * has no destroy() to stop it: only the loading task behind the proxy tears the
 * worker down. So `pdf.destroy?.()` was a no-op, and cleanup() is not this
 * either — it drops caches and leaves the thread running. Without this, reading
 * or previewing five PDFs left five workers and five parsed documents alive for
 * the rest of the session.
 */
export async function closePdf(pdf) {
  if (!pdf) return;
  try {
    if (typeof pdf.destroy === 'function') await pdf.destroy();
    else await pdf.loadingTask?.destroy?.();
  } catch {
    // Already gone, or torn down mid-render: nothing left to release.
  }
}

/**
 * The PDF's text layer, page by page, stopping at `maxChars`.
 * Returns { text, pages, pagesRead, truncated }.
 */
export async function pdfText(pdf, { maxChars = MAX_EXTRACT_CHARS, onPage = null } = {}) {
  const parts = [];
  let chars = 0;
  let pagesRead = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    onPage?.(n, pdf.numPages);
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    // hasEOL marks a line break in the extracted run; without it the whole
    // page arrives as one line and clause boundaries disappear.
    const pageText = content.items
      .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
      .join('')
      .replace(/[ \t]+\n/g, '\n');
    parts.push(pageText);
    pagesRead = n;
    chars += pageText.length;
    if (chars >= maxChars) break;
  }
  const text = parts.join('\n\n').slice(0, maxChars);
  return {
    text,
    pages: pdf.numPages,
    pagesRead,
    truncated: pagesRead < pdf.numPages || chars > maxChars,
  };
}

/** One page as a PNG blob, for OCR or for a preview. */
export async function renderPdfPage(pdf, pageNumber, { scale = 1.5, canvas = null } = {}) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const target = canvas || document.createElement('canvas');
  target.width = Math.floor(viewport.width);
  target.height = Math.floor(viewport.height);
  await page.render({ canvasContext: target.getContext('2d'), viewport }).promise;
  return target;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read the page image'))), 'image/png');
  });
}

/* ------------------------------------------------------------------ */
/* OCR                                                                 */
/* ------------------------------------------------------------------ */

async function ocrBlob(blob) {
  const result = await puter.ai.img2txt(blob);
  return typeof result === 'string' ? result : String(result?.text ?? '');
}

/** OCR a scanned PDF, page by page, up to `maxPages`. */
export async function ocrPdf(pdf, { maxPages = MAX_OCR_PAGES, maxChars = MAX_EXTRACT_CHARS, onPage = null } = {}) {
  const limit = Math.min(pdf.numPages, maxPages);
  const parts = [];
  let chars = 0;
  let pagesRead = 0;
  for (let n = 1; n <= limit; n++) {
    onPage?.(n, limit);
    const canvas = await renderPdfPage(pdf, n, { scale: 2 });
    const pageText = await ocrBlob(await canvasToBlob(canvas));
    parts.push(pageText);
    pagesRead = n;
    chars += pageText.length;
    if (chars >= maxChars) break;
  }
  return {
    text: parts.join('\n\n').slice(0, maxChars),
    pages: pdf.numPages,
    pagesRead,
    truncated: pagesRead < pdf.numPages || chars > maxChars,
  };
}

/* ------------------------------------------------------------------ */
/* The one entry point                                                 */
/* ------------------------------------------------------------------ */

/**
 * Text for any readable document.
 *
 * `read` supplies the bytes (store.readDocument). `onStatus` is called with a
 * human sentence for each stage, because a 40-page OCR run is slow and
 * silence reads as a hang.
 *
 * `confirmOcr` is asked only at the moment OCR is actually needed — a PDF with
 * a text layer is read in the browser and never triggers it, so the user is
 * not warned about sending pages away when nothing is being sent.
 *
 * Returns { text, method: 'text' | 'pdf' | 'ocr', pages, pagesRead, truncated }.
 */
export async function documentText(doc, {
  read,
  maxChars = MAX_EXTRACT_CHARS,
  allowOcr = true,
  confirmOcr = null,
  onStatus = null,
} = {}) {
  const say = (message) => onStatus?.(message);
  const okToOcr = async () => {
    if (!allowOcr) throw new Error('OCR_NOT_ALLOWED');
    if (confirmOcr && !(await confirmOcr(doc))) throw new Error('OCR_DECLINED');
  };

  if (isTextDoc(doc)) {
    say('Reading the document…');
    const blob = await read(doc);
    const text = await blob.text();
    return {
      text: text.slice(0, maxChars),
      method: 'text',
      pages: null,
      pagesRead: null,
      truncated: text.length > maxChars,
    };
  }

  if (isImageDoc(doc)) {
    await okToOcr();
    say('Scanned image: reading it by OCR…');
    const blob = await read(doc);
    const text = await ocrBlob(blob);
    return {
      text: text.slice(0, maxChars),
      method: 'ocr',
      pages: 1,
      pagesRead: 1,
      truncated: text.length > maxChars,
    };
  }

  if (isPdfDoc(doc)) {
    say('Opening the PDF…');
    const blob = await read(doc);
    const pdf = await openPdf(blob);
    try {
      const layer = await pdfText(pdf, {
        maxChars,
        onPage: (n, total) => say(`Reading page ${n} of ${total}…`),
      });
      // A scan has a page count but no words: fall back to OCR.
      if (layer.text.trim().length >= TEXT_LAYER_MIN_CHARS * Math.max(1, layer.pagesRead)) {
        return { ...layer, method: 'pdf' };
      }
      await okToOcr();
      say('No text layer: reading the pages by OCR…');
      const ocr = await ocrPdf(pdf, {
        maxChars,
        onPage: (n, total) => say(`Reading page ${n} of ${total} by OCR…`),
      });
      return { ...ocr, method: 'ocr' };
    } finally {
      // The text is already in hand, so the document and its worker can go.
      await closePdf(pdf);
    }
  }

  throw new Error('UNREADABLE_DOC');
}

/** One line describing what was read, shown next to the suggestions. */
export function readSummary(result) {
  if (!result) return '';
  const pages = result.pagesRead
    ? `${result.pagesRead}${result.pages && result.pages !== result.pagesRead ? ` of ${result.pages}` : ''} page${result.pagesRead === 1 ? '' : 's'}`
    : '';
  if (result.method === 'ocr') {
    return `Scanned document, read by OCR${pages ? ` (${pages})` : ''}. Check the suggestions carefully.`;
  }
  if (result.method === 'pdf') {
    return `Read ${pages || 'the PDF'}${result.truncated ? '; the rest was too long to send' : ''}.`;
  }
  return `Read the document${result.truncated ? '; the rest was too long to send' : ''}.`;
}
