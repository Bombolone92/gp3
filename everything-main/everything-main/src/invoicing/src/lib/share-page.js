/**
 * The public share page: one static, self-contained HTML file per shared
 * document.
 *
 * Loaded only when something is actually published, because it inlines both
 * the paper stylesheet and the PDF writer's source — a share page has to keep
 * working with no network of ours behind it, so it can fetch nothing.
 */

import paperCss from '../styles/paper.css?raw';
import pdfSource from './pdf.js?raw';
import { esc, fileSize } from './util.js';
import { paperHTML } from '../ui/paper.js';
import { docLang, translator } from './i18n.js';

/**
 * JSON safe to embed in a <script> element: only the sequence that would end
 * the element early matters, and JSON has no other way out of it.
 */
function jsonScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export async function sharePageHTML(doc, client, settings, payLink, { files = [] } = {}) {
  const isInvoice = doc.kind === 'invoice';
  // The page speaks the document's language, like the paper it wraps.
  const lang = docLang(doc, client);
  const tr = translator(lang);
  const title = `${doc.number} · ${settings.business?.name || tr(isInvoice ? 'invoice' : 'estimate')}`;
  const paper = paperHTML(doc, client, settings, { payLink });
  // The client sees the same paper as a file, built in their own browser.
  const { docSpec } = await import('./pdf-spec.js');
  const spec = docSpec(doc, client, settings, { payLink });
  return `<!doctype html>
<html lang="${esc(lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  /* The UA rule for [hidden] is a bare display: none, which the .btn
     display below would silently beat; the PDF button must stay hidden
     until the writer inlined further down proves it works. */
  [hidden] { display: none !important; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #eceef2;
    color: #17181c;
    -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) { body { background: #101114; } }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
  .bar {
    display: flex; justify-content: space-between; align-items: center;
    gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
  }
  /* #6d7078 clears 4.5:1 on the paper's white but only 4.26:1 on the wash
     behind it, and this line is the page's only heading. .paper-sub's own
     gray holds 5.58:1 there. */
  .bar-note { font-size: 13px; color: #5b5e66; }
  @media (prefers-color-scheme: dark) { .bar-note { color: #9a9da6; } }
  .actions { display: flex; gap: 10px; }
  .btn {
    display: inline-block; padding: 11px 20px; border-radius: 9px;
    font: inherit; font-weight: 650; font-size: 14.5px; cursor: pointer;
    text-decoration: none; border: 1px solid rgba(23,24,28,0.2);
    background: #ffffff; color: #17181c;
  }
  .btn-pay { background: #2b49c4; border-color: #2b49c4; color: #ffffff; }
  /* Files published alongside the page: plain links to files already there,
     because this page fetches nothing to render itself. */
  .files {
    margin-top: 18px; padding: 16px 18px; border-radius: 12px;
    background: #ffffff; border: 1px solid rgba(23,24,28,0.1);
  }
  .files-label {
    font-size: 11px; font-weight: 700; letter-spacing: 0.09em;
    text-transform: uppercase; color: #6d7078; margin-bottom: 10px;
  }
  .file {
    display: flex; justify-content: space-between; gap: 12px;
    padding: 9px 2px; color: #17181c; text-decoration: none;
    border-bottom: 1px solid rgba(23,24,28,0.07); font-size: 14px;
  }
  .file:last-child { border-bottom: 0; }
  .file:hover { color: #2b49c4; }
  .file-size { color: #6d7078; font-variant-numeric: tabular-nums; }
  @media print { .files { display: none; } }
  /* The paper stylesheet below gives the line-item table a horizontal scroll
     rail for narrow phones. A scroll container is monolithic — it cannot be
     split across pages — so without this a client printing a long invoice
     from this page would lose every line past the first sheet. */
  @media print {
    .bar { display: none; }
    body { background: #fff; }
    .paper { border: 0; }
    .paper-table-scroll { overflow: visible; }
    .paper-table tr, .paper-trow { break-inside: avoid; }
  }
${paperCss}
</style>
</head>
<body>
<main class="wrap">
  <div class="bar">
    <span class="bar-note">${esc(tr(isInvoice ? 'invoice' : 'estimate'))} ${esc(doc.number)}</span>
    <span class="actions">
      <button class="btn" id="pdf" type="button" hidden>${esc(tr('downloadPdf'))}</button>
      <button class="btn" onclick="window.print()" type="button">${esc(tr('print'))}</button>
      ${payLink && isInvoice ? `<a class="btn btn-pay" href="${esc(payLink)}" rel="noopener">${esc(tr('payNow'))}</a>` : ''}
    </span>
  </div>
  <div class="paper">${paper}</div>
  ${files.length ? `<div class="files">
    <div class="files-label">${esc(tr('attachments'))}</div>
    ${files.map((f) => `<a class="file" href="./${esc(f.href)}" download>${esc(f.name)}${f.size ? `<span class="file-size">${esc(fileSize(f.size))}</span>` : ''}</a>`).join('')}
  </div>` : ''}
</main>
<script type="application/json" id="spec">${jsonScript(spec)}</script>
<script type="module">
${pdfSource}
// The button is revealed only once the writer is here and working, so a page
// that somehow cannot build a PDF simply offers printing instead.
try {
  const spec = JSON.parse(document.getElementById('spec').textContent);
  const button = document.getElementById('pdf');
  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await downloadPdf(spec);
    } catch (err) {
      console.error(err);
      window.print();
    }
    button.disabled = false;
  });
} catch (err) {
  console.error(err);
}
</script>
</body>
</html>`;
}
