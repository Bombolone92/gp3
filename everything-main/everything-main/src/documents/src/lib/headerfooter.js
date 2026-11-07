import { SCROLLER_SELECTOR } from './print.js';
/**
 * Header and footer editing. The engine runs its own editing session for
 * them: double-clicking the top or bottom margin of a page opens the band
 * with a "Header / Footer · Options · ×" label, typing edits the part, and
 * Escape (or the ×) returns to the body. There is no public method to start
 * that session, so the Insert menu reaches it the way a pointer would: by
 * synthesizing the double-click on the page that is most in view.
 */

export const PAGE_SELECTOR = '.document-page';
/** Present in the host while a header or footer session is open. */
export const SESSION_SELECTOR = '.v2-hf-exit';
const CSS_PX_PER_INCH = 96;

/**
 * Index of the rect with the most vertical overlap with `view`, or -1 when
 * none is visible at all. Ties go to the earlier page.
 */
export function mostVisible(rects, view) {
  let best = -1;
  let bestOverlap = 0;
  rects.forEach((r, i) => {
    const overlap = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
  });
  return best;
}

/**
 * Where to double-click on a page: the middle of the header or footer band,
 * `marginPx` tall from the page edge, never deeper than a quarter of the page.
 */
export function marginPoint(pageRect, kind, marginPx) {
  const inset = Math.max(4, Math.min(marginPx / 2, pageRect.height / 4));
  return {
    x: pageRect.left + pageRect.width / 2,
    y: kind === 'header' ? pageRect.top + inset : pageRect.bottom - inset,
  };
}

/** The element inside `host` that scrolls the pages. */
export function findScroller(host) {
  // The engine's own scroll box, when painted; a walk over every painted element with its computed style is the fallback.
  return host.querySelector(SCROLLER_SELECTOR) || [...host.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) || null;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * openHeaderFooter(host, 'header' | 'footer', { marginIn, zoom })
 * Resolves true when the engine opened its editing session. isAvailable lets
 * the caller stop an obsolete request before a click or after an async wait.
 */
export async function openHeaderFooter(host, kind, { marginIn = 0.5, zoom = 100, isAvailable = () => true } = {}) {
  if (!isAvailable()) return false;
  const pages = [...host.querySelectorAll(PAGE_SELECTOR)];
  if (!pages.length) return false;
  const hostRect = host.getBoundingClientRect();
  const page = pages[Math.max(0, mostVisible(pages.map((p) => p.getBoundingClientRect()), hostRect))];
  const marginPx = Math.max(0.25, marginIn) * CSS_PX_PER_INCH * (zoom / 100);
  let pt = marginPoint(page.getBoundingClientRect(), kind, marginPx);

  // The band has to be on screen for the hit test to land on the page.
  const scroller = findScroller(host);
  if (scroller && (pt.y < hostRect.top + 8 || pt.y > hostRect.bottom - 8)) {
    scroller.scrollTop += pt.y - (hostRect.top + hostRect.height / 2);
    await nextFrame();
    pt = marginPoint(page.getBoundingClientRect(), kind, marginPx);
  }
  if (!isAvailable()) return false;
  const target = document.elementFromPoint(pt.x, pt.y);
  if (!target || !host.contains(target)) return false;
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2, button: 0, clientX: pt.x, clientY: pt.y }));
  for (let i = 0; i < 6; i++) {
    if (!isAvailable()) return false;
    if (host.querySelector(SESSION_SELECTOR)) return true;
    await wait(60);
  }
  return false;
}

/** Whether a header or footer editing session is open in `host`. */
export function inHeaderFooter(host) {
  return !!host?.querySelector(SESSION_SELECTOR);
}
