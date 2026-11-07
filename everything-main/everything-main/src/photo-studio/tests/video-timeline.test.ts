import { describe, expect, it } from 'vitest';
import { allLayers, findLayer, layer, newDocument, type Layer, type PhotoDocument } from '../src/model/document';
import { History } from '../src/history/history';
import { createAnimation, framesFromLayers, setFrameDelay } from '../src/model/animation';
import { newPixelLayer, commitPixelTranslation, pixelTransformKind, documentTileIds } from '../src/model/pixel-layer';
import { TileStore, gridFromImage, readRGBA, writeRect, type TileGrid } from '../src/model/tiles';
import { deserialize, serialize, validateDocument } from '../src/model/serialization';
import { Assets } from '../src/model/assets';
import { sourceMimeType } from '../src/model/embedded';
import { createArtboard } from '../src/model/artboard';
import {
  clipStates,
  createTimeline,
  presentTimeline,
  setKey,
  syncTimeline,
  tintStyle,
  valueAt,
  type Clip,
  type FrameLookup,
} from '../src/model/video-timeline';
import {
  animationToTimeline,
  applyTime,
  keyTimes,
  moveClip,
  moveKey,
  neededFrames,
  rulerStep,
  setInterpolation,
  setTimelineFps,
  splitClip,
  timecode,
  timeDocument,
  timelineToAnimation,
  toggleKeyAtCurrent,
  toggleStopwatch,
  trimClipEnd,
  trimClipStart,
  workArea,
} from '../src/model/video-timeline-ops';
import { blankVideo, footageVideo } from '../src/model/video-layer';

const store = new TileStore();
function block(rgb: [number, number, number], w = 8, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width: w, height: h, data };
}
/** A history that normalizes like the editor: bake pixel moves, then record the time. */
function session(doc: PhotoDocument) {
  const h = new History(doc);
  h.normalize = (d, before) => {
    for (const l of allLayers(d.layers)) if (l.kind === 'pixel' && pixelTransformKind(l) === 'translate') commitPixelTranslation(l);
    syncTimeline(d, before);
  };
  return h;
}
const get = (h: History, id: string) => findLayer(h.document.layers, id)!;

describe('video timeline: keyframes', () => {
  it('interpolates linearly and holds', () => {
    const keys = [{ t: 0, v: 0 }, { t: 10, v: 1 }, { t: 20, v: 0.5, hold: true as const }];
    expect(valueAt(keys, -5)).toBe(0);
    expect(valueAt(keys, 5)).toBeCloseTo(0.5);
    expect(valueAt(keys, 15)).toBeCloseTo(0.75);
    expect(valueAt(keys, 30)).toBe(0.5);
    const held = setInterpolation(keys, [0], true);
    expect(valueAt(held, 9)).toBe(0);
    expect(valueAt(setInterpolation(held, [0], false), 5)).toBeCloseTo(0.5);
    // Positions interpolate per component; styles by their numeric settings.
    expect(valueAt([{ t: 0, v: [0, 10] as [number, number] }, { t: 4, v: [8, 30] as [number, number] }], 1)).toEqual([2, 15]);
    const style = valueAt([{ t: 0, v: { enabled: true, colorOverlay: [{ opacity: 0 }] } }, { t: 10, v: { enabled: true, colorOverlay: [{ opacity: 1 }] } }], 3) as { colorOverlay: { opacity: number }[] };
    expect(style.colorOverlay[0].opacity).toBeCloseTo(0.3);
  });

  it('sets, moves and replaces keys in time order', () => {
    let keys = setKey([{ t: 10, v: 1 }], 5, 0.5);
    expect(keys.map((k) => k.t)).toEqual([5, 10]);
    keys = setKey(setInterpolation(keys, [5], true), 5, 0.25);
    expect(keys[0]).toEqual({ t: 5, v: 0.25, hold: true });
    expect(moveKey(keys, 5, 12).map((k) => k.t)).toEqual([10, 12]);
    expect(moveKey(keys, 5, 10)).toEqual([{ t: 10, v: 0.25, hold: true }]);
  });

  it('records opacity and position keys for edits at the current time', () => {
    const doc = newDocument(100, 80);
    const px = newPixelLayer('Ball', doc, gridFromImage(store, block([200, 0, 0]), 10, 10));
    doc.layers = [px];
    doc.timeline = createTimeline(10, 2);
    const h = session(doc);
    h.execute('Stopwatch', (d) => {
      toggleStopwatch(d, px.id, 'opacity');
      toggleStopwatch(d, px.id, 'position');
    });
    expect(h.document.timeline!.clips[px.id].keys!.opacity).toEqual([{ t: 0, v: 1 }]);
    // Change time, then edit: keys appear at the new time.
    h.execute('Time', (d) => applyTime(d, 10));
    h.execute('Opacity', (d) => (findLayer(d.layers, px.id)!.opacity = 0.2));
    h.execute('Move', (d) => {
      const l = findLayer(d.layers, px.id)!;
      l.transform = { ...l.transform, x: l.transform.x + 30 };
    });
    const clip = h.document.timeline!.clips[px.id];
    expect(clip.keys!.opacity).toEqual([{ t: 0, v: 1 }, { t: 10, v: 0.2 }]);
    expect(clip.keys!.position).toEqual([{ t: 0, v: [0, 0] }, { t: 10, v: [30, 0] }]);
    expect(get(h, px.id).pixels!.x).toBe(30);
    // Halfway: interpolated values are written into the layer.
    h.execute('Time', (d) => applyTime(d, 5));
    expect(get(h, px.id).opacity).toBeCloseTo(0.6);
    expect(get(h, px.id).pixels!.x).toBe(15);
    expect(keyTimes(h.document.timeline!, px.id)).toEqual([0, 10]);
    // Moving without a stopwatch moves the layer at every time.
    h.execute('Stopwatch', (d) => toggleStopwatch(d, px.id, 'position'));
    h.execute('Move', (d) => {
      const l = findLayer(d.layers, px.id)!;
      l.transform = { ...l.transform, x: l.transform.x + 5 };
    });
    h.execute('Time', (d) => applyTime(d, 0));
    expect(get(h, px.id).pixels!.x).toBe(20);
    expect(get(h, px.id).opacity).toBe(1);
  });

  it('adds and removes a key at the current time', () => {
    const doc = newDocument(50, 50);
    const l = layer('solid', 'Card', 10, 10);
    doc.layers = [l];
    doc.timeline = createTimeline(10, 2);
    toggleStopwatch(doc, l.id, 'opacity');
    applyTime(doc, 8);
    toggleKeyAtCurrent(doc, l.id, 'opacity');
    expect(keyTimes(doc.timeline!, l.id, 'opacity')).toEqual([0, 8]);
    toggleKeyAtCurrent(doc, l.id, 'opacity');
    expect(keyTimes(doc.timeline!, l.id, 'opacity')).toEqual([0]);
    toggleKeyAtCurrent(doc, l.id, 'opacity');
    applyTime(doc, 0);
    toggleKeyAtCurrent(doc, l.id, 'opacity');
    // Removing the last key turns the stopwatch off.
    applyTime(doc, 8);
    toggleKeyAtCurrent(doc, l.id, 'opacity');
    expect(doc.timeline!.clips[l.id].keys).toBeUndefined();
  });
});

describe('video timeline: clips', () => {
  const clip: Clip = { start: 10, in: 5, length: 20 };
  it('moves, trims and splits clips', () => {
    expect(moveClip(clip, -30, 100).start).toBe(0);
    expect(moveClip(clip, 7, 100)).toEqual({ ...clip, start: 17 });
    // Trimming the start moves the in point with it; footage stops at frame 0.
    expect(trimClipStart(clip, 4)).toEqual({ start: 14, in: 9, length: 16 });
    expect(trimClipStart(clip, -20, 40)).toEqual({ start: 5, in: 0, length: 25 });
    expect(trimClipStart(clip, -8)).toEqual({ start: 2, in: -3, length: 28 });
    expect(trimClipStart(clip, 100)).toEqual({ start: 29, in: 24, length: 1 });
    // The end trims to at least one frame and at most the content.
    expect(trimClipEnd(clip, -50).length).toBe(1);
    expect(trimClipEnd(clip, 50, 40).length).toBe(35);
    expect(trimClipEnd(clip, 50).length).toBe(70);
    const parts = splitClip({ ...clip, fadeIn: { kind: 'fade', duration: 3 }, fadeOut: { kind: 'fade', duration: 4 }, keys: { opacity: [{ t: 8, v: 1 }] } }, 18)!;
    expect(parts[0]).toEqual({ start: 10, in: 5, length: 8, fadeIn: { kind: 'fade', duration: 3 }, keys: { opacity: [{ t: 8, v: 1 }] } });
    expect(parts[1]).toEqual({ start: 18, in: 13, length: 12, fadeOut: { kind: 'fade', duration: 4 }, keys: { opacity: [{ t: 8, v: 1 }] } });
    expect(splitClip(clip, 10)).toBeNull();
    expect(splitClip(clip, 30)).toBeNull();
  });

  it('hides layers outside their clips when drawn and fades transitions', () => {
    const doc = newDocument(40, 40);
    const a = layer('solid', 'A', 10, 10);
    const b = layer('solid', 'B', 10, 10);
    doc.layers = [a, b];
    doc.timeline = createTimeline(10, 4);
    doc.timeline.clips[a.id] = { start: 0, in: 0, length: 20, fadeIn: { kind: 'fade', duration: 4 }, fadeOut: { kind: 'fade-color', duration: 5, color: '#ff0000' } };
    doc.timeline.clips[b.id] = { start: 20, in: 0, length: 20 };
    const at = (t: number) => {
      doc.timeline!.current = t;
      return presentTimeline({ ...doc });
    };
    expect(at(0).layers[0].opacity).toBe(0);
    expect(at(2).layers[0].opacity).toBeCloseTo(0.5);
    expect(at(10).layers[0]).toBe(a);
    expect(at(10).layers[1].visible).toBe(false);
    // Fade with color mixes the color over the layer, fully at the last frame.
    const tinted = at(19).layers[0].style as { colorOverlay: { opacity: number; color: number[] }[] };
    expect(tinted.colorOverlay.at(-1)).toMatchObject({ opacity: 1, color: [255, 0, 0] });
    expect((at(17).layers[0].style as { colorOverlay: { opacity: number }[] }).colorOverlay.at(-1)!.opacity).toBeCloseTo(0.6);
    expect(at(25).layers[0].visible).toBe(false);
    expect(at(25).layers[1]).toBe(b);
    // A layer style that is switched off stays off apart from the tint.
    expect(tintStyle({ enabled: false, dropShadow: [] }, '#000000', 0.5)).toEqual({ enabled: true, colorOverlay: [{ enabled: true, blendMode: 'normal', opacity: 0.5, color: [0, 0, 0] }] });
    // Without a timeline documents pass through.
    const plain = newDocument(10, 10);
    expect(presentTimeline(plain)).toBe(plain);
  });

  it('cross fades adjacent clips: both show over the overlap and the upper one fades', () => {
    const doc = newDocument(40, 40);
    const a = layer('solid', 'A', 10, 10);
    const b = layer('solid', 'B', 10, 10);
    doc.layers = [a, b];
    doc.timeline = createTimeline(10, 4);
    doc.timeline.clips[a.id] = { start: 0, in: 0, length: 20 };
    doc.timeline.clips[b.id] = { start: 20, in: 0, length: 20, fadeIn: { kind: 'cross-fade', duration: 4 } };
    // The overlap is frames 18–21; B is above A and fades in.
    const s = (t: number) => clipStates(doc, t);
    expect(s(17).get(b.id)!.shown).toBe(false);
    expect(s(18).get(b.id)).toMatchObject({ shown: true, factor: 0.2, content: -2 });
    expect(s(18).get(a.id)).toMatchObject({ shown: true, factor: 1 });
    expect(s(21).get(a.id)).toMatchObject({ shown: true, content: 21 });
    expect(s(21).get(b.id)!.factor).toBeCloseTo(0.8);
    expect(s(22).get(a.id)!.shown).toBe(false);
    expect(s(22).get(b.id)!.factor).toBe(1);
    // With A on top, A fades out instead.
    doc.layers = [b, a];
    expect(s(19).get(a.id)!.factor).toBeCloseTo(0.6);
    expect(s(19).get(b.id)!.factor).toBe(1);
    // Without a partner a cross fade fades in.
    doc.timeline.clips[a.id].length = 10;
    expect(s(20).get(b.id)).toMatchObject({ shown: true, factor: 0 });
  });

  it('keeps times in seconds when the frame rate changes', () => {
    const tl = createTimeline(30, 2);
    tl.current = 45;
    tl.work = [15, 45];
    tl.clips.x = { start: 30, in: 6, length: 30, fadeIn: { kind: 'fade', duration: 15 }, keys: { opacity: [{ t: 0, v: 0 }, { t: 1, v: 0.5 }, { t: 30, v: 1 }] } };
    setTimelineFps(tl, 15);
    expect(tl).toMatchObject({ fps: 15, duration: 30, current: 23, work: [8, 23] });
    expect(tl.clips.x).toMatchObject({ start: 15, in: 3, length: 15, fadeIn: { duration: 8 } });
    // Keys that land on one frame merge (the later wins).
    expect(tl.clips.x.keys!.opacity!.map((k) => k.t)).toEqual([0, 1, 15]);
    expect(workArea({ ...tl, work: undefined })).toEqual([0, 30]);
  });

  it('formats time and picks ruler steps', () => {
    expect(timecode(0, 30)).toBe('0:00:00');
    expect(timecode(75, 30)).toBe('0:02:15');
    expect(timecode(30 * 3725, 30)).toBe('1:02:05:00');
    expect(timecode(9, 10)).toBe('0:00:9');
    expect(rulerStep(30, 10)).toBe(10);
    expect(rulerStep(30, 1)).toBe(150);
    expect(rulerStep(30, 0.01)).toBe(9000);
    expect(rulerStep(30, 0.001)).toBe(18000);
  });
});

describe('video timeline: video layers', () => {
  /** A 4-frame footage layer whose decoded frames are solid colors. */
  function videoFixture() {
    const doc = newDocument(64, 48);
    const colors: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    const grids = colors.map((c) => gridFromImage(store, block(c, 16, 16)));
    const v = newPixelLayer('Clip', doc, { ...grids[0], x: 4, y: 4 });
    v.video = footageVideo({ asset: 'a', name: 'clip.webm', type: 'video/webm', width: 16, height: 16, frames: 4, fps: 5 }, 4, 4);
    doc.layers = [v];
    doc.timeline = createTimeline(10, 1);
    doc.timeline.clips[v.id] = { start: 0, in: 0, length: 8 };
    const lookup: FrameLookup = (_l, _k, source) => grids[source];
    return { doc, v, lookup, grids };
  }
  const color = (doc: PhotoDocument, id: string) => {
    const l = findLayer(doc.layers, id)!;
    return Array.from(readRGBA(store, l.pixels!, { x: 8, y: 8, width: 1, height: 1 }).data);
  };

  it('shows the footage frame for each time at the layer frame rate', () => {
    const { doc, v, lookup } = videoFixture();
    applyTime(doc, 3, lookup);
    // 10 fps timeline over 5 fps footage: time 3 shows frame 1.
    expect(color(doc, v.id)).toEqual([0, 255, 0, 255]);
    expect(neededFrames(doc, 7).map((n) => [n.k, n.source])).toEqual([[3, 3]]);
    // Beyond the clip, nothing is needed.
    expect(neededFrames(doc, 9)).toEqual([]);
    // A frame that is not decoded leaves the frame shown.
    applyTime(doc, 5, () => undefined);
    expect(color(doc, v.id)).toEqual([0, 255, 0, 255]);
  });

  it('records painting as an altered frame and shows it again later', () => {
    const { doc, v, lookup } = videoFixture();
    const h = session(doc);
    h.execute('Time', (d) => applyTime(d, 2, lookup));
    h.execute('Paint', (d) => {
      const l = findLayer(d.layers, v.id)!;
      l.pixels = writeRect(store, l.pixels!, 6, 6, block([9, 9, 9], 4, 4));
    });
    expect(Object.keys(get(h, v.id).video!.altered!)).toEqual(['1']);
    h.execute('Time', (d) => applyTime(d, 6, lookup));
    expect(color(h.document, v.id)).toEqual([255, 255, 0, 255]);
    h.execute('Time', (d) => applyTime(d, 3, lookup));
    expect(Array.from(readRGBA(store, get(h, v.id).pixels!, { x: 7, y: 7, width: 1, height: 1 }).data)).toEqual([9, 9, 9, 255]);
    // Show Altered Video off shows the footage.
    h.execute('Hide', (d) => {
      d.timeline!.hideAltered = true;
      applyTime(d, 3, lookup);
    });
    expect(Array.from(readRGBA(store, get(h, v.id).pixels!, { x: 7, y: 7, width: 1, height: 1 }).data)).toEqual([0, 255, 0, 255]);
    // Altered tiles are kept by tile collection.
    const grid = h.document.layers[0].video!.altered![1] as TileGrid;
    const ids = documentTileIds(h.document);
    for (const id of Object.values(grid.tiles)) expect(ids.has(id)).toBe(true);
  });

  it('moves every frame when the layer moves and keeps the origin through frame changes', () => {
    const { doc, v, lookup } = videoFixture();
    const h = session(doc);
    h.execute('Move', (d) => {
      const l = findLayer(d.layers, v.id)!;
      l.transform = { ...l.transform, x: l.transform.x + 10, y: l.transform.y + 2 };
    });
    expect(get(h, v.id).video).toMatchObject({ x: 14, y: 6 });
    expect(get(h, v.id).video!.altered).toBeUndefined();
    h.execute('Time', (d) => applyTime(d, 4, lookup));
    expect(get(h, v.id).pixels).toMatchObject({ x: 14, y: 6 });
    expect(get(h, v.id).transform).toMatchObject({ x: 14, y: 6, width: 16, height: 16 });
  });

  it('builds documents for other times without changing the original', () => {
    const { doc, v, lookup } = videoFixture();
    const at = timeDocument(doc, 4, lookup);
    expect(at.timeline!.current).toBe(4);
    expect(at.timeline!.placed).toBeUndefined();
    expect(color(at, v.id)).toEqual([0, 0, 255, 255]);
    expect(doc.timeline!.current).toBe(0);
  });

  it('blank video layers show empty frames until painted', () => {
    const doc = newDocument(32, 32);
    const l = newPixelLayer('Blank', doc);
    l.video = blankVideo(32, 32, 10, 10);
    doc.layers = [l];
    doc.timeline = createTimeline(10, 1);
    const h = session(doc);
    h.execute('Paint', (d) => {
      const x = findLayer(d.layers, l.id)!;
      x.pixels = writeRect(store, x.pixels!, 0, 0, block([1, 2, 3], 4, 4));
    });
    h.execute('Time', (d) => applyTime(d, 1));
    expect(get(h, l.id).pixels!.bounds).toBeNull();
    h.execute('Time', (d) => applyTime(d, 0));
    expect(get(h, l.id).pixels!.bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });
});

describe('video timeline: documents', () => {
  it('validates in projects and rejects a document with both kinds of animation', () => {
    const doc = newDocument(30, 30);
    const l = newPixelLayer('V', doc, gridFromImage(store, block([1, 1, 1])));
    l.video = blankVideo(30, 30, 5, 10);
    doc.layers = [l];
    doc.timeline = createTimeline(10, 1);
    doc.timeline.clips[l.id] = { start: 0, in: 0, length: 5, keys: { opacity: [{ t: 0, v: 1, hold: true }, { t: 3, v: 0.5 }] }, fadeOut: { kind: 'fade-color', duration: 2, color: '#ffffff' } };
    expect(() => validateDocument(structuredClone(doc))).not.toThrow();
    expect(() => validateDocument({ ...structuredClone(doc), animation: createAnimation(doc) })).toThrow(/either/);
    const bad = structuredClone(doc);
    bad.timeline!.clips[l.id].fadeOut = { kind: 'cross-fade', duration: 2 };
    expect(() => validateDocument(bad)).toThrow(/video timeline/);
    const badKeys = structuredClone(doc);
    badKeys.timeline!.clips[l.id].keys!.opacity = [{ t: 3, v: 1 }, { t: 1, v: 1 }];
    expect(() => validateDocument(badKeys)).toThrow(/video timeline/);
    const badVideo = structuredClone(doc);
    badVideo.layers[0].video!.frames = 0;
    expect(() => validateDocument(badVideo)).toThrow(/video layer/);
  });

  it('saves footage, altered frames, clips and keyframes in projects', async () => {
    const assets = new Assets();
    const doc = newDocument(32, 32);
    const asset = await assets.add(new Blob([new Uint8Array([1, 2, 3, 4])], { type: sourceMimeType }));
    const l = newPixelLayer('V', doc, gridFromImage(assets.tiles, block([5, 6, 7], 8, 8)));
    l.video = footageVideo({ asset, name: 'clip.webm', type: 'video/webm', width: 8, height: 8, frames: 3, fps: 10 });
    l.video.altered = { 2: gridFromImage(assets.tiles, block([200, 100, 50], 4, 4), 2, 2) };
    doc.layers = [l];
    doc.timeline = createTimeline(10, 1);
    doc.timeline.clips[l.id] = { start: 1, in: 0, length: 3, keys: { position: [{ t: 0, v: [0, 0] }, { t: 2, v: [4, 0], hold: true }] }, fadeIn: { kind: 'cross-fade', duration: 2 } };
    const loaded = await deserialize(await serialize(doc, assets));
    const v = loaded.document.layers[0];
    expect(v.video!.footage).toEqual(l.video.footage);
    expect(await loaded.assets.blob(asset).arrayBuffer()).toEqual(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(loaded.document.timeline).toEqual(doc.timeline);
    const altered = v.video!.altered![2];
    expect(altered).toMatchObject({ x: 0, y: 0, bounds: { x: 2, y: 2, width: 4, height: 4 } });
    expect(Array.from(readRGBA(loaded.assets.tiles, altered, { x: 3, y: 3, width: 1, height: 1 }).data)).toEqual([200, 100, 50, 255]);
  });

  it('refuses artboards in a document with a video timeline', () => {
    const doc = newDocument(30, 30);
    doc.timeline = createTimeline();
    const h = session(doc);
    expect(() => h.execute('Artboard', (d) => d.layers.push(createArtboard(d, { x: 0, y: 0, width: 10, height: 10 })))).toThrow(/Artboards and a video timeline/);
    expect(h.document.layers).toEqual([]);
  });

  it('converts a frame animation to a timeline and back', () => {
    const doc = newDocument(60, 40);
    const layers: Layer[] = [0, 1, 2].map((i) => newPixelLayer(`L${i}`, doc, gridFromImage(store, block([80 * i, 0, 0]), 4 + 10 * i, 4)));
    doc.layers = layers;
    framesFromLayers(doc);
    setFrameDelay(doc, [1], 300);
    expect(animationToTimeline(doc, 10)).toBe(true);
    expect(doc.animation).toBeUndefined();
    const tl = doc.timeline!;
    // Frames of 0.1, 0.3 and 0.1 s at 10 fps.
    expect(tl.duration).toBe(5);
    expect(layers.map((l) => tl.clips[l.id])).toEqual([
      { start: 0, in: 0, length: 1 },
      { start: 1, in: 1, length: 3 },
      { start: 4, in: 4, length: 1 },
    ]);
    expect(doc.layers.every((l) => l.visible)).toBe(true);
    expect(presentTimeline(doc).layers.map((l) => l.visible)).toEqual([true, false, false]);
    // Back to frames sampled every other frame.
    const made: Layer[] = [];
    expect(timelineToAnimation(doc, [0, 2, 4], 0, 200, () => undefined, (name, grid) => (made.push(newPixelLayer(name, doc, grid)), made.at(-1)!))).toBe(true);
    expect(doc.timeline).toBeUndefined();
    const anim = doc.animation!;
    expect(anim.frames.map((f) => f.delay)).toEqual([200, 200, 200]);
    expect(anim.frames.map((f) => layers.map((l) => f.layers[l.id].visible))).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]);
    expect(() => validateDocument(structuredClone(doc))).not.toThrow();
  });

  it('turns video layers into one layer per sampled frame', () => {
    const doc = newDocument(32, 32);
    const grids = [[255, 0, 0], [0, 255, 0]].map((c) => gridFromImage(store, block(c as [number, number, number], 8, 8)));
    const v = newPixelLayer('Clip', doc, grids[0]);
    v.video = footageVideo({ asset: 'a', name: 'c', type: 'video/webm', width: 8, height: 8, frames: 2, fps: 10 });
    doc.layers = [v];
    doc.timeline = createTimeline(10, 0.2);
    const made: Layer[] = [];
    timelineToAnimation(doc, [0, 1], 0, 100, (_l, _k, j) => grids[j], (name, grid) => (made.push(newPixelLayer(name, doc, grid)), made.at(-1)!));
    expect(doc.layers.map((l) => l.name)).toEqual(['Clip 1', 'Clip 2']);
    expect(doc.layers.map((l) => l.video)).toEqual([undefined, undefined]);
    expect(doc.animation!.frames.map((f) => doc.layers.map((l) => f.layers[l.id].visible))).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});
