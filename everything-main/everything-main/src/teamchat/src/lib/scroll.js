/**
 * Where a scrolling list stands relative to its end. Two questions with two
 * different answers: whether the reader means to be at the bottom (a
 * tolerance, since a few pixels off is not a decision to read history), and
 * whether a list that is following the bottom has to be moved back to it
 * after something changed size (no tolerance at all: a shift under the
 * reader's tolerance would otherwise never be corrected, and the last line
 * would sit behind the composer until the reader nudged it).
 */

/** Within this many pixels of the end, the reader is "at the bottom". */
export const NEAR_BOTTOM_PX = 40;

/** How far above its end a scroller is, in px; 0 at the very bottom. */
export function gapBelow({ scrollHeight, scrollTop, clientHeight }) {
  return scrollHeight - scrollTop - clientHeight;
}

/** Whether the reader is at the bottom, as far as following new messages goes. */
export function nearBottom(scroller) {
  return gapBelow(scroller) < NEAR_BOTTOM_PX;
}

/**
 * Whether a list that follows the bottom must be scrolled back to it: any
 * gap at all (rounded, so a fractional layout does not scroll every frame).
 */
export function needsRepin(scroller) {
  return gapBelow(scroller) >= 1;
}

/**
 * Whether a scroll event came from the reader moving up. The layout fires
 * scroll events too — a list scrolled to the bottom reports it a frame
 * later, by when a picture may have loaded and moved the bottom on; the
 * scroller clamps when content above it shrinks; anchoring adjusts for
 * content above it growing — and none of those move scrollTop down while
 * leaving a gap. Read as the reader's intent they would end the following,
 * with every picture after that pushing the last message out of view.
 *
 * `previousMax` (the scroller's scrollHeight - clientHeight as of the last
 * event) sharpens the small moves: every layout cause above changes a
 * height, so a drop in scrollTop while both stood still can only be the
 * reader, at any size. Without it a drag slower than the pixel of jitter
 * allowance per event never registered, and the following list snapped
 * back to the bottom against the reader's hand.
 */
export function readerMovedUp(scroller, previousTop, previousMax = null) {
  if (scroller.scrollTop < previousTop - 1) return true;
  return previousMax !== null
    && scroller.scrollHeight - scroller.clientHeight === previousMax
    && scroller.scrollTop < previousTop;
}
