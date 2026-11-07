import { describe, it, expect } from 'vitest';
import { trimClip, trimBounds, splitClip, splitAt, mainTrack, addClip, MIN_CLIP, sourceTimeAt } from '../src/model/timeline.js';
import { valueAt } from '../src/model/keyframes.js';
import { fixture, clip, onMain, spans, trackOf, s } from './helpers.js';

const RIPPLE = { ripple: true, linkOverlays: true };
const FREE = { ripple: false, linkOverlays: false };

describe('trimBounds', () => {
  it('limits the right edge to the remaining source, scaled by speed', () => {
    const p = fixture(); // vid is 10 s long
    const [c] = onMain(p, clip('video', 0, 4, { in: s(2) }));
    expect(trimBounds(p, c.id, 'end', FREE).hi).toBe(s(8));
    c.speed = 2;
    expect(trimBounds(p, c.id, 'end', FREE).hi).toBe(s(4));
  });

  it('limits the left edge to the start of the source, scaled by speed', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 5, 2, { in: s(2), speed: 2 }));
    expect(trimBounds(p, c.id, 'start', FREE).lo).toBe(s(4));
  });

  it('keeps a minimum clip length', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 1, 2));
    expect(trimBounds(p, c.id, 'start', FREE).hi).toBe(s(3) - MIN_CLIP);
    expect(trimBounds(p, c.id, 'end', FREE).lo).toBe(s(1) + MIN_CLIP);
  });

  it('stops at neighbors without ripple but not with it on the base track', () => {
    const p = fixture();
    const [, b, c] = onMain(p, clip('image', 0, 2), clip('image', 3, 2), clip('image', 6, 2));
    expect(trimBounds(p, b.id, 'start', FREE).lo).toBe(s(2));
    expect(trimBounds(p, b.id, 'end', FREE).hi).toBe(s(6));
    expect(trimBounds(p, b.id, 'end', RIPPLE).hi).toBe(Infinity);
    expect(trimBounds(p, c.id, 'start', RIPPLE).lo).toBeLessThan(0);
  });

  it('lets still images and text grow without a source limit', () => {
    const p = fixture();
    const t = clip('text', 0, 2);
    addClip(p, t, RIPPLE);
    expect(trimBounds(p, t.id, 'end', RIPPLE).hi).toBe(Infinity);
  });
});

describe('trimClip', () => {
  it('moves the source in point along with the left edge', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 0, 6, { in: s(1), speed: 2 }));
    trimClip(p, c.id, 'start', s(1), FREE);
    expect(c.start).toBe(s(1));
    expect(c.duration).toBe(s(5));
    expect(c.in).toBe(s(3));
    // The frame shown at 2 s is unchanged by the trim.
    expect(sourceTimeAt(c, s(2))).toBe(s(5));
  });

  it('clamps to the source length', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 0, 4));
    trimClip(p, c.id, 'end', s(60), FREE);
    expect(c.duration).toBe(s(10));
  });

  it('ripples later base clips with ripple', () => {
    const p = fixture();
    const [a, b] = onMain(p, clip('video', 0, 4), clip('video', 4, 4));
    trimClip(p, a.id, 'end', s(2), RIPPLE);
    expect(spans(mainTrack(p))).toEqual([[0, 2], [2, 4]]);
    trimClip(p, b.id, 'start', s(3), RIPPLE);
    expect(spans(mainTrack(p))).toEqual([[0, 2], [2, 3]]);
    expect(b.in).toBe(s(1));
    expect(a.start).toBe(0);
  });

  it('leaves a gap without ripple', () => {
    const p = fixture();
    onMain(p, clip('video', 0, 4), clip('video', 4, 4));
    trimClip(p, mainTrack(p).clips[0].id, 'end', s(2), FREE);
    expect(spans(mainTrack(p))).toEqual([[0, 2], [4, 4]]);
  });

  it('shifts keyframes with a left trim so they stay on the same frames', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 0, 6, { keyframes: { x: [{ t: s(2), v: 0, ease: 'linear' }, { t: s(4), v: 1, ease: 'linear' }] } }));
    trimClip(p, c.id, 'start', s(1), FREE);
    expect(c.keyframes.x.map((k) => k.t)).toEqual([s(1), s(3)]);
  });

  it('keeps the visible motion when a trim cuts through keyframed motion', () => {
    const p = fixture();
    const keys = [{ t: 0, v: 0, ease: 'linear' }, { t: s(4), v: 1, ease: 'linear' }];
    const [c] = onMain(p, clip('video', 0, 4, { keyframes: { x: keys } }));
    trimClip(p, c.id, 'end', s(2), FREE);
    // Halfway through the old motion, x was 0.5 at 2 s and 0.25 at 1 s.
    expect(valueAt(c.keyframes, 'x', s(1), 0)).toBeCloseTo(0.25);
    expect(valueAt(c.keyframes, 'x', s(2), 0)).toBeCloseTo(0.5);
    trimClip(p, c.id, 'start', s(1), FREE);
    expect(valueAt(c.keyframes, 'x', 0, 0)).toBeCloseTo(0.25);
    expect(valueAt(c.keyframes, 'x', s(1), 0)).toBeCloseTo(0.5);
  });

  it('drops a transition when the trim pulls the clip away from its neighbor', () => {
    const p = fixture();
    const [a] = onMain(p, clip('video', 0, 4, { transition: { id: 'mix', duration: s(0.5) } }), clip('video', 4, 4));
    trimClip(p, a.id, 'end', s(3), FREE);
    expect(a.transition).toBe(null);
  });

  it('keeps a transition when ripple closes the gap the trim opens', () => {
    const p = fixture();
    const [a] = onMain(p, clip('video', 0, 4, { transition: { id: 'mix', duration: s(0.5) } }), clip('video', 4, 4));
    trimClip(p, a.id, 'end', s(3), RIPPLE);
    expect(a.transition).toEqual({ id: 'mix', duration: s(0.5) });
  });

  it('does nothing on a locked track', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 0, 4));
    mainTrack(p).locked = true;
    expect(trimClip(p, c.id, 'end', s(2), FREE)).toBe(false);
    expect(c.duration).toBe(s(4));
  });
});

describe('splitClip', () => {
  it('cuts the clip in two continuous pieces', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 1, 6, { in: s(1), speed: 2 }));
    const right = splitClip(p, c.id, s(3));
    expect(spans(mainTrack(p))).toEqual([[1, 2], [3, 4]]);
    expect(right.in).toBe(s(5));
    expect(right.id).not.toBe(c.id);
    expect(sourceTimeAt(right, s(3))).toBe(sourceTimeAt(c, s(3)));
  });

  it('refuses cuts closer than one frame to an edge', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 0, 2));
    expect(splitClip(p, c.id, 1000)).toBe(null);
    expect(splitClip(p, c.id, s(2) - 1000)).toBe(null);
    expect(mainTrack(p).clips).toHaveLength(1);
  });

  it('splits keyframes so the value at the cut is continuous', () => {
    const p = fixture();
    const kf = {
      x: [{ t: 0, v: 0, ease: 'linear' }, { t: s(4), v: 1, ease: 'linear' }],
      scale: [{ t: s(1), v: 1, ease: 'easeInOut' }, { t: s(3), v: 2, ease: 'linear' }],
    };
    const [c] = onMain(p, clip('video', 0, 4, { keyframes: structuredClone(kf) }));
    const right = splitClip(p, c.id, s(2));
    for (const prop of ['x', 'scale']) {
      const atCut = valueAt(kf, prop, s(2), 0);
      expect(valueAt(c.keyframes, prop, s(2), 0)).toBeCloseTo(atCut);
      expect(valueAt(right.keyframes, prop, 0, 0)).toBeCloseTo(atCut);
    }
    // Linear motion is reproduced exactly on both sides.
    expect(valueAt(c.keyframes, 'x', s(1), 0)).toBeCloseTo(0.25);
    expect(valueAt(right.keyframes, 'x', s(1), 0)).toBeCloseTo(0.75);
    expect(right.keyframes.x.at(-1)).toMatchObject({ t: s(2), v: 1 });
  });

  it('keeps fades and in/out animations on the outer ends', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 0, 4, {
      fadeIn: s(0.5), fadeOut: s(0.5),
      animIn: { id: 'fade-in', duration: s(0.5) }, animOut: { id: 'fade-out', duration: s(0.5) },
    }));
    const right = splitClip(p, c.id, s(2));
    expect([c.fadeIn, c.fadeOut, right.fadeIn, right.fadeOut]).toEqual([s(0.5), 0, 0, s(0.5)]);
    expect(c.animIn?.id).toBe('fade-in');
    expect(c.animOut).toBe(null);
    expect(right.animIn).toBe(null);
    expect(right.animOut?.id).toBe('fade-out');
  });

  it('gives the outgoing transition to the right-hand piece', () => {
    const p = fixture();
    const [c] = onMain(p, clip('video', 0, 4, { transition: { id: 'mix', duration: s(0.5) } }), clip('video', 4, 4));
    const right = splitClip(p, c.id, s(2));
    expect(c.transition).toBe(null);
    expect(right.transition).toEqual({ id: 'mix', duration: s(0.5) });
  });

  it('works on text clips (no source or fades)', () => {
    const p = fixture();
    const t = clip('text', 0, 4, { text: 'Hello' });
    addClip(p, t, RIPPLE);
    const right = splitClip(p, t.id, s(1));
    expect(right.text).toBe('Hello');
    expect(spans(trackOf(p, t.id))).toEqual([[0, 1], [1, 3]]);
  });
});

describe('splitAt', () => {
  it('splits every unlocked clip under the playhead when nothing is selected', () => {
    const p = fixture();
    onMain(p, clip('video', 0, 4));
    const t = clip('text', 1, 4);
    const fx = clip('effect', 3, 2); // not under 2 s
    addClip(p, t, RIPPLE);
    addClip(p, fx, RIPPLE);
    const audio = clip('audio', 0, 5);
    addClip(p, audio, RIPPLE);
    trackOf(p, audio.id).locked = true;
    const made = splitAt(p, s(2));
    expect(made).toHaveLength(2);
    expect(trackOf(p, audio.id).clips).toHaveLength(1);
    expect(trackOf(p, fx.id).clips).toHaveLength(1);
  });

  it('splits only the given clips', () => {
    const p = fixture();
    onMain(p, clip('video', 0, 4));
    const t = clip('text', 1, 4);
    addClip(p, t, RIPPLE);
    const made = splitAt(p, s(2), [t.id]);
    expect(made).toHaveLength(1);
    expect(mainTrack(p).clips).toHaveLength(1);
  });
});
