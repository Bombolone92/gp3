/** Receipt files: cached object URLs and a viewer sheet. */

import { el } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { store } from '../lib/store.js';
import { downloadBlob } from '../lib/export.js';

const urls = new Map();
const pending = new Map();

export function isPdf(exp) {
  return /pdf$/i.test(exp?.receiptMime || '') || /\.pdf$/i.test(exp?.receiptPath || '');
}

/** Object URL for an expense's receipt, or null when it has none or fails to load. */
export async function receiptURL(exp) {
  const path = exp?.receiptPath;
  if (!path) return null;
  if (urls.has(path)) return urls.get(path);
  if (pending.has(path)) return pending.get(path);
  const p = (async () => {
    try {
      const raw = await store.readReceipt(path);
      const blob = raw.type ? raw : new Blob([raw], { type: exp.receiptMime || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      urls.set(path, url);
      return url;
    } catch {
      return null;
    } finally {
      pending.delete(path);
    }
  })();
  pending.set(path, p);
  return p;
}

export function invalidateReceipt(path) {
  const url = urls.get(path);
  if (url) URL.revokeObjectURL(url);
  urls.delete(path);
}

/** Show a local file before it is uploaded (capture preview). */
export function previewURL(file) {
  return URL.createObjectURL(file);
}

export function openReceiptViewer(exp) {
  const body = el('div.receipt-viewer', {},
    el('div.receipt-loading', { html: icon('spinner', 22, 2), className: 'receipt-loading spin-wrap' }, el('span', {}, 'Loading receipt'))
  );
  const download = el('button.icon-btn', {
    type: 'button', html: icon('download', 19, 2), 'aria-label': 'Download receipt', title: 'Download',
    onclick: async () => {
      const blob = await store.readReceipt(exp.receiptPath).catch(() => null);
      if (blob) downloadBlob(blob, exp.receiptName || `receipt-${exp.id}`);
    },
  });
  const modal = openModal({ title: exp.merchant || 'Receipt', content: body, wide: true, headerActions: download });

  receiptURL(exp).then((url) => {
    body.replaceChildren();
    if (!url) {
      body.append(el('div.empty', {},
        el('div.empty-icon', { html: icon('imageOff', 26) }),
        el('h3', {}, 'Couldn’t load this receipt'),
        el('p', {}, 'The file may have been moved or deleted from your Puter drive.')
      ));
      return;
    }
    if (isPdf(exp)) {
      body.append(
        el('iframe.receipt-pdf', { src: url, title: 'Receipt PDF' }),
        el('p.small.muted', { style: { textAlign: 'center', marginTop: '10px' } },
          el('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open in a new tab'))
      );
      return;
    }
    const img = el('img.receipt-img', { src: url, alt: `Receipt from ${exp.merchant || 'unknown merchant'}` });
    const wrap = el('button.receipt-zoom', {
      type: 'button', 'aria-label': 'Toggle zoom', 'aria-pressed': 'false',
      onclick: () => {
        const on = wrap.classList.toggle('zoomed');
        wrap.setAttribute('aria-pressed', String(on));
      },
    }, img);
    body.append(wrap);
  });
  return modal;
}
