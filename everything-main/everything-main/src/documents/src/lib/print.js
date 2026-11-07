/**
 * Printing the document as the pages you see.
 *
 * The engine paints only the pages near the viewport; pages scrolled away are
 * empty shells, so printing the editor as it stands would send blank sheets.
 * Printing therefore walks the editor's own scroll box page by page, and as
 * each page is painted copies it into a print-only stage the screen never
 * shows. The print stylesheet then hides the app and shows the stage, one
 * page per sheet, so the printout (or the PDF the print dialog saves) carries
 * the real pagination, headers, footers, page numbers, images, and fonts.
 *
 * `printPages()` resolves true when the print dialog opened this way and
 * false when the pages could not all be captured, so the caller can fall back
 * to a plain HTML rendition.
 */

export const PAGE_SELECTOR = '.document-page';
export const SCROLLER_SELECTOR = '.document-scroller';
const STAGE_CLASS = 'print-stage';
const BODY_CLASS = 'printing';
const STYLE_ID = 'print-page-rule';
const CSS_PX_PER_INCH = 96;

/** The `@page` rule for a paper size in inches; falls back to Letter. */
export function pageRule(widthIn, heightIn, name = null) {
  const w = Number.isFinite(widthIn) && widthIn > 0 ? widthIn : 8.5;
  const h = Number.isFinite(heightIn) && heightIn > 0 ? heightIn : 11;
  const fmt = (n) => String(Math.round(n * 1000) / 1000);
  return `@page${name ? ` ${name}` : ''} { size: ${fmt(w)}in ${fmt(h)}in; margin: 0; }`;
}

/**
 * One page rule per distinct sheet size: the first size is the default page,
 * later ones are named pages the sheets of that size are assigned to, so a
 * landscape section prints on landscape paper.
 */
export function pageRulesFor(sheets, fallback) {
  const sizes = [];
  for (const sheet of sheets) {
    const size = pageSizeOf(sheet) || fallback;
    let index = sizes.findIndex((s) => Math.abs(s.width - size.width) < 0.001 && Math.abs(s.height - size.height) < 0.001);
    if (index < 0) { sizes.push(size); index = sizes.length - 1; }
    if (index) sheet.style.page = `document-page-${index}`;
  }
  if (!sizes.length) sizes.push(fallback);
  return sizes.map((s, i) => pageRule(s.width, s.height, i ? `document-page-${i}` : null)).join('\n');
}

/**
 * The paper size of a painted page in inches, read from the pixel size the
 * engine gives it (96 CSS pixels to the inch). Null when unreadable.
 */
export function pageSizeOf(page) {
  const w = Number.parseFloat(page?.style?.width);
  const h = Number.parseFloat(page?.style?.height);
  if (!(w > 0) || !(h > 0)) return null;
  return { width: w / CSS_PX_PER_INCH, height: h / CSS_PX_PER_INCH };
}

/**
 * Whether a page element is painted. The engine marks pages it has not
 * painted as shells (`data-v2-page-content="shell"`) with no children.
 */
export function isPainted(page) {
  return !!page && page.dataset?.v2PageContent !== 'shell' && page.childElementCount > 0;
}

/** Whether every page in the list is painted. */
export function allPagesPainted(pages) {
  const list = [...(pages || [])];
  return list.length > 0 && list.every(isPainted);
}

/**
 * The scroll offset that brings `page` to the top of `scroller`, from live
 * geometry (the page column may be scaled by the zoom transform).
 */
export function scrollOffsetFor(page, scroller) {
  return scroller.scrollTop + page.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

/** Stop waiting when the editor closes, even if a resource never settles. */
function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Poll until `check()` holds, the editor closes, or `timeout` passes. */
async function until(check, { timeout = 3000, every = 50, signal } = {}) {
  const started = performance.now();
  while (!check()) {
    if (signal?.aborted || performance.now() - started > timeout) return false;
    let timer;
    await abortable(new Promise((r) => { timer = setTimeout(r, every); }), signal);
    clearTimeout(timer);
  }
  return !signal?.aborted;
}

/**
 * Copy every page of the document into `into`, in order, scrolling
 * `scroller` so the engine paints each one first. Resolves false when a page
 * did not paint in time. The scroll position is restored afterwards.
 */
export async function capturePages(host, into, { pageTimeout = 3000, signal } = {}) {
  if (signal?.aborted) return false;
  const scroller = host.querySelector(SCROLLER_SELECTOR);
  const pages = [...host.querySelectorAll(PAGE_SELECTOR)];
  if (!scroller || !pages.length) return false;
  const restore = scroller.scrollTop;
  const copies = new Array(pages.length).fill(null);
  const take = () => {
    for (let i = 0; i < pages.length; i++) {
      if (!copies[i] && isPainted(pages[i])) copies[i] = pages[i].cloneNode(true);
    }
  };
  try {
    take();
    for (let i = 0; i < pages.length; i++) {
      if (copies[i]) continue;
      scroller.scrollTop = Math.max(0, scrollOffsetFor(pages[i], scroller));
      if (!(await until(() => isPainted(pages[i]), { timeout: pageTimeout, signal }))) return false;
      take();
    }
  } finally {
    scroller.scrollTop = restore;
  }
  into.replaceChildren(...copies);
  return true;
}

/** Resolve once the images in `root` have loaded (or failed), within `timeout`. */
async function imagesSettled(root, signal, timeout = 8000) {
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  if (!pending.length) return;
  let timer;
  const listeners = [];
  try {
    await abortable(Promise.race([
      Promise.all(pending.map((img) => new Promise((r) => {
        img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true });
        listeners.push(() => { img.removeEventListener('load', r); img.removeEventListener('error', r); });
      }))),
      new Promise((r) => { timer = setTimeout(r, timeout); }),
    ]), signal);
  } finally {
    clearTimeout(timer);
    for (const remove of listeners) remove();
  }
}

/**
 * Capture the pages of the engine mounted in `host` and open the print
 * dialog on them.
 *
 *   host      the element the editor's engine renders into
 *   pageSize  { width, height } in inches, used when a page cannot be measured
 *   onReady   called just before the print dialog opens
 *   signal    aborts preparation when the editor closes
 *
 * Resolves true when the dialog opened with the captured pages, false when
 * the pages could not be captured (nothing printed).
 */
export async function printPages({ host, pageSize = {}, onReady = () => {}, signal, capture } = {}) {
  if (!host || signal?.aborted) return false;
  const stage = document.createElement('div');
  stage.className = STAGE_CLASS;
  stage.setAttribute('aria-hidden', 'true');
  const sheets = document.createElement('div');
  sheets.className = `${STAGE_CLASS}-pages`;
  stage.append(sheets);
  const style = document.createElement('style');
  style.id = STYLE_ID;
  document.body.append(stage, style);
  const cleanup = () => {
    stage.remove();
    style.remove();
    document.body.classList.remove(BODY_CLASS);
  };

  try {
    let captured = false;
    try {
      if (capture) {
        const pages = await capture();
        sheets.replaceChildren(...pages);
        captured = pages.length > 0;
      } else captured = await capturePages(host, sheets, { signal });
    } catch (e) {
      console.error(e);
    }
    if (!captured || signal?.aborted) return false;
    style.textContent = pageRulesFor([...sheets.children], pageSize);
    await imagesSettled(sheets, signal);
    if (signal?.aborted) return false;
    try { await abortable(document.fonts?.ready, signal); } catch { /* fonts API unavailable */ }
    if (signal?.aborted) return false;

    document.body.classList.add(BODY_CLASS);
    onReady();
    // Most browsers block in print() until the dialog closes and then fire
    // `afterprint`; where print() returns at once, `afterprint` still marks the
    // end. A long timer covers a dialog that never reports back.
    return await new Promise((resolve) => {
      let done = false;
      let watchdog, startTimer, fallbackTimer;
      const afterPrint = () => finish(true);
      const abort = () => finish(false);
      const finish = (success) => {
        if (done) return;
        done = true;
        window.removeEventListener('afterprint', afterPrint);
        signal?.removeEventListener('abort', abort);
        clearTimeout(watchdog); clearTimeout(startTimer); clearTimeout(fallbackTimer);
        resolve(success);
      };
      if (signal?.aborted) { finish(false); return; }
      signal?.addEventListener('abort', abort, { once: true });
      window.addEventListener('afterprint', afterPrint);
      watchdog = setTimeout(() => finish(true), 120000);
      // A short pause lets the print stylesheet take effect before the dialog
      // snapshots the page (a timer, not an animation frame: background tabs
      // stall frames).
      startTimer = setTimeout(() => {
        try { window.print(); } catch (e) { console.error(e); finish(false); }
        if (!done && !('onafterprint' in window)) fallbackTimer = setTimeout(() => finish(true), 1500);
      }, 80);
    });
  } finally {
    cleanup();
  }
}
