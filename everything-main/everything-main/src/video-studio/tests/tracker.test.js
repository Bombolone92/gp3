import { describe, it, expect } from 'vitest';
import { trackFrames, ncc, Tracker } from '../src/media/tracker.js';
import { mediaBox, sourcePointToFrame, pinKeys, trackingSource } from '../src/ui/tracking-dialog.js';
import { clipLayer } from '../src/engine/scene.js';
import { addClip } from '../src/model/timeline.js';
import { fixture, clip, onMain, s } from './helpers.js';

const W = 96;
const H = 54;
/** A frame with a textured square at (x, y) on a noisy background. */
function frame(x, y, seed = 1) {
  const f = new Float32Array(W * H);
  let r = seed;
  for (let i = 0; i < f.length; i++) {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    f[i] = 0.3 + (r / 0x7fffffff) * 0.1;
  }
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
    const xx = Math.round(x) + i;
    const yy = Math.round(y) + j;
    if (xx >= 0 && xx < W && yy >= 0 && yy < H) f[yy * W + xx] = (i + j) % 3 === 0 ? 1 : (i * j) % 5 === 0 ? 0 : 0.7;
  }
  return f;
}

describe('tracker', () => {
  it('scores a template against itself as a perfect match', () => {
    const f = frame(20, 20);
    const tpl = f.slice(0); // full frame as template
    expect(ncc(f, W, H, tpl, W, H, 0, 0)).toBeCloseTo(1);
  });

  it('follows a moving square', () => {
    const path = Array.from({ length: 12 }, (_, i) => ({ x: 10 + i * 4, y: 15 + Math.round(i * 1.5) }));
    const frames = path.map((p, i) => frame(p.x, p.y, i + 1));
    const out = trackFrames(frames, W, H, { x: 10, y: 15, w: 10, h: 10 });
    out.forEach((p, i) => {
      expect(Math.abs(p.x - (path[i].x + 5))).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y - (path[i].y + 5))).toBeLessThanOrEqual(1);
    });
    expect(Math.min(...out.slice(1).map((p) => p.score))).toBeGreaterThan(0.6);
  });

  it('coasts when the object disappears', () => {
    const t = new Tracker(frame(30, 20), W, H, { x: 30, y: 20, w: 10, h: 10 });
    const blank = new Float32Array(W * H).fill(0.3);
    const r = t.step(blank);
    expect(r.score).toBeLessThan(0.35);
    expect(Number.isFinite(r.x)).toBe(true);
  });
});

describe('pinning to tracked motion', () => {
  it('maps source points through the clip transform', () => {
    const p = fixture();
    const [v] = onMain(p, clip('video', 0, 4));
    v.transform.scale = 2;
    v.transform.x = 0.1;
    const layer = clipLayer(p, v, s(1), 0);
    const box = mediaBox(p, layer);
    const center = sourcePointToFrame(box, 0.5, 0.5);
    expect(center.x).toBeCloseTo(p.settings.width / 2 + 0.1 * p.settings.width);
    const right = sourcePointToFrame(box, 1, 0.5);
    expect(right.x - center.x).toBeCloseTo(p.settings.width); // 1920 wide fit, scaled 2x, half of it
  });

  it('turns tracked points into position keys relative to the start', () => {
    const p = fixture();
    onMain(p, clip('video', 0, 4));
    const txt = clip('text', 0, 4);
    addClip(p, txt, { ripple: false });
    txt.transform.x = 0.2;
    const pts = [0, 1, 2, 3].map((i) => ({ t: s(i), x: 960 + i * 192, y: 540 }));
    const keys = pinKeys(p, txt, pts, s(0));
    expect(keys.x[0]).toMatchObject({ t: 0, v: 0.2 });
    expect(keys.x.at(-1).v).toBeCloseTo(0.2 + 0.3);
    expect(keys.y.every((k) => Math.abs(k.v) < 1e-9)).toBe(true);
    expect(trackingSource(p, txt, s(1)).clip.type).toBe('video');
  });
});
