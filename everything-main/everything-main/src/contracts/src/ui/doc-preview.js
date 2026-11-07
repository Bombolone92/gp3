/**
 * Reading an attached document without leaving the app.
 *
 * Before this, seeing a signed agreement meant downloading it and opening it
 * somewhere else — several taps and a trip out of the app on a phone, in the
 * exact moment (a meeting, a supplier's office) when someone asks what the
 * notice period is.
 */

import { el, clear, append } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../lib/store.js';
import { formatBytes, downloadBlob } from '../lib/util.js';
import { isPdfDoc, isImageDoc, isTextDoc, openPdf, closePdf, renderPdfPage } from '../lib/doctext.js';

/** Rendered eagerly; more load on request, so a 90-page PDF stays responsive. */
const FIRST_PAGES = 3;
const MORE_PAGES = 5;

export function openDocumentPreview(doc) {
  const body = el('div');
  const urls = [];
  let pdf = null;
  // The bytes, once read: the fallback screens offer a download even when
  // nothing could be shown, because the file itself is still fine.
  let bytes = null;
  // Closing destroys the pdf.js document mid-render, which rejects every page
  // still in flight. Those rejections are expected, not failures to report.
  let closed = false;

  const modal = openModal({
    title: doc.name,
    content: body,
    wide: true,
    onClose: () => {
      closed = true;
      for (const url of urls) URL.revokeObjectURL(url);
      closePdf(pdf);
    },
  });

  const objectUrl = (blob) => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };

  const downloadRow = (blob) => el('div.row.wrap', { style: { marginTop: '12px' } },
    el('button.btn.btn-ghost.btn-compact', {
      html: icon('download', 14, 2),
      onclick: () => downloadBlob(blob, doc.name),
    }, ' Download'),
    el('span.field-hint', {}, formatBytes(doc.size)));

  function renderBusy(message) {
    clear(body);
    body.append(el('div.extract-busy', {},
      el('span.spinner', { 'aria-hidden': 'true' }),
      el('p', { role: 'status' }, message)
    ));
  }

  function renderProblem(message, blob = null) {
    clear(body);
    append(body, [
      el('div.callout.callout-warn', {},
        el('span', { html: icon('info', 18, 2) }),
        el('div', {}, message)),
      blob ? downloadRow(blob) : null,
    ]);
  }

  async function render() {
    renderBusy('Opening the document…');
    let blob;
    try {
      blob = await store.readDocument(doc);
      bytes = blob;
    } catch (err) {
      console.error(err);
      renderProblem('Could not read this document from your cloud. Check your connection.');
      return;
    }

    if (isImageDoc(doc)) {
      clear(body);
      append(body, [
        el('img.doc-image', { src: objectUrl(blob), alt: doc.name }),
        downloadRow(blob),
      ]);
      return;
    }

    if (isTextDoc(doc)) {
      const text = await blob.text();
      clear(body);
      append(body, [
        el('pre.doc-text', {}, text),
        downloadRow(blob),
      ]);
      return;
    }

    if (isPdfDoc(doc)) {
      let opened;
      try {
        opened = await openPdf(blob);
      } catch (err) {
        console.error(err);
        renderProblem('This PDF could not be opened here. Downloading it will still work.', blob);
        return;
      }
      // Closed while it was opening: onClose had nothing to release yet, so
      // releasing it is this branch's job.
      if (closed) {
        closePdf(opened);
        return;
      }
      pdf = opened;
      clear(body);
      const pageWrap = el('div.doc-pages');
      const status = el('p.field-hint', {}, `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`);
      const moreBtn = el('button.btn.btn-ghost.btn-block', { style: { marginTop: '10px' } });
      let shown = 0;

      const renderPages = async (count) => {
        moreBtn.disabled = true;
        try {
          const until = Math.min(pdf.numPages, shown + count);
          for (let n = shown + 1; n <= until; n++) {
            if (closed) return;
            const canvas = el('canvas.doc-page', { 'aria-label': `Page ${n}` });
            // Fit the sheet's width; the canvas element scales down with CSS.
            // Drawn before it goes in, so a page that fails leaves no blank.
            await renderPdfPage(pdf, n, { scale: 1.5, canvas });
            if (closed) return;
            pageWrap.append(canvas);
            shown = n;
          }
        } finally {
          // A page that failed halfway must not leave the button that loads
          // the rest stuck disabled, and the count has to match what is drawn.
          if (!closed) {
            moreBtn.disabled = false;
            updateMore();
          }
        }
      };

      const updateMore = () => {
        const left = pdf.numPages - shown;
        moreBtn.style.display = left > 0 ? '' : 'none';
        moreBtn.textContent = left > 0
          ? `Show ${Math.min(MORE_PAGES, left)} more page${Math.min(MORE_PAGES, left) === 1 ? '' : 's'} (${left} left)`
          : '';
        status.textContent = `Showing ${shown} of ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;
      };

      moreBtn.addEventListener('click', () => {
        renderPages(MORE_PAGES).catch((err) => {
          // Closing the sheet cancels the pages still drawing. That is the
          // user's own doing, not a failure to report at them.
          if (closed) return;
          console.error(err);
          toast('Could not render that page', { icon: 'info' });
        });
      });

      append(body, [status, pageWrap, moreBtn, downloadRow(blob)]);
      await renderPages(FIRST_PAGES);
      return;
    }

    renderProblem('There is no preview for this file type, but you can download it.', blob);
  }

  // Everything below the read has its own error screen, but a decode that
  // fails, a page that will not draw, or a document destroyed by closing the
  // sheet all landed here as an unhandled rejection — leaving the spinner
  // turning for good with nothing said.
  render().catch((err) => {
    if (closed) return;
    console.error(err);
    renderProblem('This document could not be shown here. Downloading it will still work.', bytes);
  });
  return modal;
}
