import { describe, it, expect, afterEach, vi } from 'vitest';
import { STICKERS, drawSticker, stickerInfo, isAnimatedSticker, isMultiColorSticker, stickerColor } from '../src/engine/stickers.js';
import { EXTRA_STICKERS, EXTRA_CATEGORIES, shade } from '../src/engine/stickers-extra.js';
import { STICKER_CATEGORIES } from '../src/model/catalog.js';
import { TextCache, STICKER_ANIM_FPS } from '../src/engine/text.js';
import { clipLayer } from '../src/engine/scene.js';
import { makeClip, normalizeClip } from '../src/model/project.js';
import { fixture } from './helpers.js';
import { mockContext } from './canvas-mock.js';

// jsdom has no Path2D; the Lucide icon graphics build their paths with it.
globalThis.Path2D ||= class Path2D {
  constructor(d) {
    this.d = d;
  }
};

const CATS = new Set([...STICKER_CATEGORIES, ...EXTRA_CATEGORIES].map((c) => c.id));

describe('graphics catalog', () => {
  it('has well over a hundred graphics with unique ids in known categories', () => {
    expect(STICKERS.length).toBeGreaterThanOrEqual(110);
    expect(EXTRA_STICKERS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    for (const s of STICKERS) {
      expect(CATS.has(s.cat), `${s.id} category ${s.cat}`).toBe(true);
      expect(s.label).toBeTruthy();
    }
  });

  it('gives every multi-color graphic a main palette color', () => {
    const multi = STICKERS.filter((s) => s.multi);
    expect(multi.length).toBeGreaterThanOrEqual(25);
    for (const s of multi) expect(s.main, s.id).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('has a dozen or more animated graphics', () => {
    const anim = STICKERS.filter((s) => s.anim).map((s) => s.id);
    expect(anim.length).toBeGreaterThanOrEqual(12);
    for (const id of ['heart-pulse', 'sparkle-spin', 'arrow-bounce', 'typing-dots', 'equalizer', 'eyes-blink', 'wave-hand']) {
      expect(anim).toContain(id);
      expect(isAnimatedSticker(id)).toBe(true);
    }
    expect(isAnimatedSticker('star')).toBe(false);
  });

  it('resolves the drawing color from the color mode', () => {
    expect(isMultiColorSticker('face-smile')).toBe(true);
    expect(stickerColor('face-smile', '#123456', 'original')).toBe(stickerInfo('face-smile').main);
    expect(stickerColor('face-smile', '#123456', undefined)).toBe('#123456');
    // Single-color graphics always use the clip color.
    expect(stickerColor('star', '#123456', 'original')).toBe('#123456');
  });

  it('shades colors toward black or white', () => {
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#ff0000', 0)).toBe('#ff0000');
    expect(shade('nope', 0.5)).toBe('nope');
  });
});

describe('drawing graphics', () => {
  for (const s of STICKERS) {
    it(`${s.id} draws with finite coordinates`, () => {
      for (const t of s.anim ? [0, 0.37, 1.9, 12.5] : [0]) {
        const g = mockContext();
        expect(() => drawSticker(g, s.id, s.main || '#ffd23f', 200, { t })).not.toThrow();
        expect(g.bad, `${s.id} at ${t}s`).toEqual([]);
        // Something was actually painted.
        expect(g.calls.some(([name]) => ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText'].includes(name)), s.id).toBe(true);
      }
    });
  }

  it('animated graphics change over time and repeat deterministically', () => {
    for (const s of STICKERS.filter((x) => x.anim)) {
      const at = (t) => {
        const g = mockContext();
        drawSticker(g, s.id, s.main || '#ffffff', 100, { t });
        return JSON.stringify(g.calls);
      };
      const frames = new Set([0, 0.13, 0.29, 0.41, 0.62, 0.87, 1.05, 1.33, 2.2, 2.71].map(at));
      expect(frames.size, `${s.id} should move`).toBeGreaterThan(1);
      expect(at(0.5)).toBe(at(0.5));
    }
  });

  it('a negative or missing time draws the first frame', () => {
    const a = mockContext();
    const b = mockContext();
    drawSticker(a, 'heart-pulse', '#ff0000', 100, { t: -3 });
    drawSticker(b, 'heart-pulse', '#ff0000', 100);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
  });
});

describe('graphic clips', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the original-colors mode through normalization', () => {
    const c = makeClip('sticker', { sticker: 'face-cool', colorMode: 'original' });
    expect(normalizeClip(c).colorMode).toBe('original');
    expect(normalizeClip({ ...c, colorMode: 'weird' }).colorMode).toBeUndefined();
    expect('colorMode' in normalizeClip(makeClip('sticker', { sticker: 'star' }))).toBe(false);
  });

  it('passes clip-local time to the layer and redraws animated graphics per frame', () => {
    const contexts = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      const g = mockContext();
      contexts.push(g);
      return g;
    });
    const p = fixture();
    const clip = makeClip('sticker', { sticker: 'heart-pulse', start: 1e6, duration: 3e6, color: '#ff3355' });
    const cache = new TextCache();
    const at = (t) => cache.get(clipLayer(p, clip, t, 0), 1);
    const a = at(1e6);
    expect(clipLayer(p, clip, 1.5e6, 0).local).toBe(0.5e6);
    const same = at(1e6 + 1e6 / STICKER_ANIM_FPS / 3);
    expect(same.version).toBe(a.version);
    const b = at(1.5e6);
    expect(b.version).toBeGreaterThan(a.version);

    // Still graphics draw once for any time.
    const still = makeClip('sticker', { sticker: 'star', start: 0, duration: 3e6 });
    const s1 = cache.get(clipLayer(p, still, 0, 0), 1);
    const s2 = cache.get(clipLayer(p, still, 2e6, 0), 1);
    expect(s2.version).toBe(s1.version);
  });

  it('redraws when the color mode changes', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => mockContext());
    const p = fixture();
    const clip = makeClip('sticker', { sticker: 'face-smile', start: 0, duration: 3e6, color: '#00ff00' });
    const cache = new TextCache();
    const a = cache.get(clipLayer(p, clip, 0, 0), 1);
    clip.colorMode = 'original';
    const b = cache.get(clipLayer(p, clip, 0, 0), 1);
    expect(b.version).toBeGreaterThan(a.version);
  });
});
