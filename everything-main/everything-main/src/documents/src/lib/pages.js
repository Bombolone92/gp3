/**
 * Moving through the document by page number. The engine keeps one element
 * per page (`.document-page[data-page-number]`) whether or not the page is
 * painted, so going to a page is a scroll of the engine's scroll box; the
 * page paints as it comes into view.
 */

import { PAGE_SELECTOR, SCROLLER_SELECTOR, scrollOffsetFor } from './print.js';
import { scrollBehavior } from '../ui/dom.js';

const PAGE_MARGIN = 12; // a little canvas above the page edge

/** The page number to go to from what the user typed, or null. */
export function parsePageNumber(input, total) {
  const n = Number.parseInt(String(input ?? '').trim(), 10);
  if (!Number.isInteger(n) || n < 1) return null;
  if (Number.isInteger(total) && total > 0 && n > total) return null;
  return n;
}

/** The page element for a 1-based page number, or null. */
export function pageElement(host, n) {
  if (!host || !Number.isInteger(n)) return null;
  return [...host.querySelectorAll(PAGE_SELECTOR)].find((p) => Number(p.dataset.pageNumber) === n) || null;
}

/**
 * Scroll the engine's scroll box so page `n` starts at the top. True when it
 * could. Smooth when the tab is visible and motion is not reduced; a hidden
 * tab never finishes a smooth scroll, so it jumps.
 */
export function scrollToPage(host, n, { behavior = (typeof document !== 'undefined' && document.hidden ? 'auto' : scrollBehavior()) } = {}) {
  const scroller = host?.querySelector(SCROLLER_SELECTOR);
  const page = pageElement(host, n);
  if (!scroller || !page) return false;
  const top = Math.max(0, scrollOffsetFor(page, scroller) - PAGE_MARGIN);
  if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior });
  else scroller.scrollTop = top;
  return true;
}
