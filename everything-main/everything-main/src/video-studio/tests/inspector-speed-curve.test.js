import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorStore } from '../src/model/store.js';
import { createProject, makeClip } from '../src/model/project.js';
import { createActions } from '../src/ui/actions.js';
import { createInspector } from '../src/ui/inspector/index.js';
import { speedToPos } from '../src/ui/inspector/speed.js';
import { curveGlyph } from '../src/ui/inspector/speed-curve.js';
import { CURVE_PRESETS, meanSpeed, presetPoints, sourceSpan } from '../src/model/speed-curve.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

// jsdom has no canvas; the editor still handles input.
HTMLCanvasElement.prototype.getContext = () => null;

let env;

function setup() {
  const p = createProject();
  p.assets.a1 = { id: 'a1', kind: 'video', name: 'clip.mp4', duration: 20 * US, width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true };
  const v1 = makeClip('video', { assetId: 'a1', start: 0, duration: 4 * US, name: 'One' });
  const v2 = makeClip('video', { assetId: 'a1', start: 4 * US, duration: 4 * US, name: 'Two' });
  T.mainTrack(p).clips.push(v1, v2);
  const store = new EditorStore(p);
  const ctx = { store };
  ctx.actions = createActions(ctx);
  const insp = createInspector(ctx);
  document.body.append(insp.el);
  return { store, insp, el: insp.el, v1, v2 };
}

const clip = (id) => T.findClip(env.store.project, id).clip;
const tab = (name) => [...env.el.querySelectorAll('[role=tab]')].find((t) => t.textContent === name);
const tile = (label) => [...env.el.querySelectorAll('.speed-preset-grid .choice')].find((b) => b.textContent === label);
const canvas = () => env.el.querySelector('.speed-curve-canvas');
const key = (k, opts = {}) => {
  canvas().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
  canvas().dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, ...opts }));
};
const pointer = (type, x, y) => canvas().dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));

function openCurve() {
  env.store.select(env.v1.id);
  tab('Speed').click();
  tab('Curve').click();
}

beforeEach(() => {
  env = setup();
});

afterEach(() => {
  env.insp.dispose();
  env.el.remove();
});

describe('speed curve inspector', () => {
  it('has Constant and Curve sub-tabs and a tile per preset', () => {
    openCurve();
    expect(tab('Constant')).toBeTruthy();
    const labels = [...env.el.querySelectorAll('.speed-preset-grid .choice-label')].map((x) => x.textContent);
    expect(labels).toEqual(['None', ...CURVE_PRESETS.map((p) => p.label), 'Custom']);
    expect(tile('None').getAttribute('aria-checked')).toBe('true');
    for (const p of CURVE_PRESETS) expect(curveGlyph(p.points).querySelector('.speed-glyph-line').getAttribute('d')).not.toMatch(/NaN/);
  });

  it('applies a preset in one undo step, keeping the footage and rippling', () => {
    openCurve();
    tile('Ramp up').click();
    const c = clip(env.v1.id);
    expect(c.speedCurve).toEqual(presetPoints('ramp-up'));
    expect(c.duration).toBe(Math.round((4 * US) / meanSpeed(c.speedCurve)));
    expect(clip(env.v2.id).start).toBe(c.duration);
    expect(tile('Ramp up').getAttribute('aria-checked')).toBe('true');
    expect(env.el.querySelector('.speed-curve-dur').textContent).toBe(`${(c.duration / US).toFixed(1)}s`);
    env.store.undo();
    expect(clip(env.v1.id).speedCurve).toBeUndefined();
    expect(clip(env.v1.id).duration).toBe(4 * US);
    expect(tile('None').getAttribute('aria-checked')).toBe('true');
  });

  it('None and Reset go back to constant speed', () => {
    openCurve();
    tile('Pulse').click();
    tile('None').click();
    expect(clip(env.v1.id).speedCurve).toBeUndefined();
    tile('Stutter').click();
    env.el.querySelector('[aria-label="Reset Speed curve"]').click();
    expect(clip(env.v1.id).speedCurve).toBeUndefined();
    expect(clip(env.v1.id).speed).toBe(1);
  });

  it('keyboard edits move a point, one undo step per run', () => {
    openCurve();
    tile('Ease in-out').click();
    canvas().focus();
    key('PageDown'); // first point
    key('PageDown'); // middle point
    const before = clip(env.v1.id).speedCurve[1].v;
    const span = sourceSpan(clip(env.v1.id));
    canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    canvas().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    canvas().dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
    const c = clip(env.v1.id);
    expect(c.speedCurve[1].v).toBeCloseTo(before * 1.05 * 1.05, 3);
    expect(sourceSpan(c)).toBeCloseTo(span, -2);
    expect(tile('Custom').getAttribute('aria-checked')).toBe('true');
    env.store.undo();
    expect(clip(env.v1.id).speedCurve[1].v).toBe(before);
    // Add and remove a point.
    key('+');
    expect(clip(env.v1.id).speedCurve).toHaveLength(4);
    key('Delete');
    expect(clip(env.v1.id).speedCurve).toHaveLength(3);
  });

  it('click adds a point, drag shapes it, all as one undo step', () => {
    openCurve();
    tile('Ramp down').click();
    const n = clip(env.v1.id).speedCurve.length;
    // The editor falls back to 280 x 168 px in jsdom; (150, 40) is mid clip, fast.
    pointer('pointerdown', 150, 40);
    pointer('pointermove', 160, 30);
    pointer('pointerup', 160, 30);
    const c = clip(env.v1.id);
    expect(c.speedCurve).toHaveLength(n + 1);
    const added = c.speedCurve.find((p) => p.t > 0 && p.t < 1);
    expect(added.v).toBeGreaterThan(3);
    env.store.undo();
    expect(clip(env.v1.id).speedCurve).toEqual(presetPoints('ramp-down'));
  });

  it('Custom starts a flat curve at the clip speed', () => {
    env.store.select(env.v1.id);
    tab('Speed').click();
    const r = env.el.querySelector('.speed-field input[type=range]');
    r.value = String(speedToPos(2));
    r.dispatchEvent(new Event('input', { bubbles: true }));
    r.dispatchEvent(new Event('change', { bubbles: true }));
    tab('Curve').click();
    tile('Custom').click();
    const c = clip(env.v1.id);
    expect(c.speedCurve.map((p) => p.v)).toEqual([2, 2, 2]);
    expect(c.duration).toBe(2 * US);
  });

  it('opens on Curve for a curved clip; a constant speed replaces the curve', () => {
    openCurve();
    tile('Fast middle').click();
    env.store.select(env.v2.id);
    env.store.select(env.v1.id);
    expect(tab('Curve').getAttribute('aria-selected')).toBe('true');
    tab('Constant').click();
    expect(env.el.querySelector('.speed-tab .insp-note').hidden).toBe(false);
    const chip = [...env.el.querySelectorAll('.chip')].find((b) => b.textContent === '1x');
    chip.click();
    expect(clip(env.v1.id).speedCurve).toBeUndefined();
    expect(clip(env.v1.id).duration).toBe(4 * US);
  });

  it('the pitch option works from both sub-tabs', () => {
    openCurve();
    const sw = () => env.el.querySelector('.speed-pitch [role=switch]');
    sw().click();
    expect(clip(env.v1.id).keepPitch).toBe(false);
    tab('Constant').click();
    expect(sw().getAttribute('aria-checked')).toBe('false');
    sw().click();
    expect('keepPitch' in clip(env.v1.id)).toBe(false);
  });
});
