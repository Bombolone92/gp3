/**
 * The two bottom checks of a message list: the reader's tolerance for
 * following new messages, and the exact check for keeping a following list
 * pinned when the layout shifts under it.
 */
import { describe, it, expect } from 'vitest';
import { gapBelow, nearBottom, needsRepin, readerMovedUp, NEAR_BOTTOM_PX } from '../src/lib/scroll.js';

const scroller = (gap) => ({ scrollHeight: 4000, clientHeight: 500, scrollTop: 3500 - gap });

describe('gapBelow', () => {
  it('is the distance from the viewport to the end', () => {
    expect(gapBelow(scroller(0))).toBe(0);
    expect(gapBelow(scroller(37))).toBe(37);
  });
});

describe('nearBottom', () => {
  it('tolerates a small gap, as a reader a few pixels up still means the bottom', () => {
    expect(nearBottom(scroller(0))).toBe(true);
    expect(nearBottom(scroller(NEAR_BOTTOM_PX - 1))).toBe(true);
    expect(nearBottom(scroller(NEAR_BOTTOM_PX))).toBe(false);
    expect(nearBottom(scroller(400))).toBe(false);
  });
});

describe('needsRepin', () => {
  it('asks for a re-pin on any gap the reader would see, not only past the tolerance', () => {
    // A pin bar arriving after its pins load, or a composer growing by an
    // attachment row, takes some 36px from the scroller: less than the
    // reader's tolerance, but the last message is now behind the composer.
    expect(needsRepin(scroller(36))).toBe(true);
    expect(needsRepin(scroller(1))).toBe(true);
    expect(needsRepin(scroller(NEAR_BOTTOM_PX + 200))).toBe(true);
  });

  it('leaves a list at the bottom alone, fractional layout included', () => {
    expect(needsRepin(scroller(0))).toBe(false);
    expect(needsRepin(scroller(0.5))).toBe(false);
  });
});

describe('readerMovedUp', () => {
  it('is false for the scroll event a scroll to the bottom fires, even when pictures have since moved the bottom on', () => {
    // Re-pinned at scrollTop 3500 (gap 0); two pictures load before the
    // event is dispatched, so it reports a 560px gap with scrollTop unmoved.
    const grown = { scrollHeight: 4560, clientHeight: 500, scrollTop: 3500 };
    expect(gapBelow(grown)).toBe(560);
    expect(readerMovedUp(grown, 3500)).toBe(false);
    // The re-pin itself moved scrollTop up the page, never down.
    expect(readerMovedUp(scroller(0), 3200)).toBe(false);
  });

  it('is false for the scroller clamping after content above the viewport shrank', () => {
    // A 160px skeleton above the viewport gave way to an unsized image:
    // scrollTop fell by 160 with the list still at the very bottom, and
    // nearBottom is what tells the caller to keep following.
    const clamped = { scrollHeight: 3840, clientHeight: 500, scrollTop: 3340 };
    expect(readerMovedUp(clamped, 3500)).toBe(true);
    expect(nearBottom(clamped)).toBe(true);
  });

  it('is true when the reader scrolls up, and a pixel of jitter is not a move', () => {
    expect(readerMovedUp(scroller(100), 3500)).toBe(true);
    expect(readerMovedUp(scroller(1), 3500)).toBe(false);
  });

  it('with the layout standing still, a drop of any size is the reader', () => {
    // scroller() keeps scrollHeight 4000 / clientHeight 500, so max is 3500.
    // A slow trackpad drag moves under a pixel per event; only a changed
    // height moves scrollTop down without the reader, so with neither height
    // moved this is a move — the allowance would snap the drag back to the
    // bottom on every second event, and the reader could never leave.
    expect(readerMovedUp(scroller(0.8), 3500, 3500)).toBe(true);
    expect(readerMovedUp(scroller(1), 3500, 3500)).toBe(true);
    expect(readerMovedUp(scroller(0), 3500, 3500)).toBe(false);
  });

  it('the same small drop alongside a layout change keeps the allowance', () => {
    const grown = { scrollHeight: 4001, clientHeight: 500, scrollTop: 3499.5 };
    expect(readerMovedUp(grown, 3500, 3500)).toBe(false);
    // The late re-pin event (pictures moved the bottom on, scrollTop unmoved)
    // stays layout with the third argument given.
    const pictures = { scrollHeight: 4560, clientHeight: 500, scrollTop: 3500 };
    expect(readerMovedUp(pictures, 3500, 3500)).toBe(false);
  });
});
