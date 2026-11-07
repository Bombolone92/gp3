import { el } from './dom.js';

/**
 * Hand a generated file to the browser's downloader.
 *
 * The anchor has to be in the document for the click, and the object URL is
 * revoked only after the download has had time to start - revoking
 * synchronously can abort it.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
