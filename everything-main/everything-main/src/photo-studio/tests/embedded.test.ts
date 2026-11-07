import { describe, expect, it } from 'vitest';
import { layer, newDocument, type PhotoDocument } from '../src/model/document';
import { Assets } from '../src/model/assets';
import { deserialize, serialize, validateDocument } from '../src/model/serialization';
import { copyContents, instancesOf, projectMimeType, usedEmbeds, validateEmbeds, type EmbeddedContents } from '../src/model/embedded';
import { reduceSamples, stackLayers } from '../src/imaging/stack';
import { effectiveFrame, frameStale, instanceQuad, pendingFrame, plainPlacement, rescaleFrame, rescaleTransform } from '../src/features/embedded/frame-math';
import { transformQuad } from '../src/features/transform/math';
import { History } from '../src/history/history';

const reduce = (values: number[], mode: Parameters<typeof reduceSamples>[2]) =>
  reduceSamples(Float64Array.from(values), values.length, mode, new Float64Array(values.length));

describe('stack statistics', () => {
  it('computes order statistics and sums', () => {
    expect(reduce([10, 50, 20], 'mean')).toBe(27);
    expect(reduce([10, 50, 20], 'median')).toBe(20);
    expect(reduce([10, 50, 20, 40], 'median')).toBe(30);
    expect(reduce([10, 50, 20], 'minimum')).toBe(10);
    expect(reduce([10, 50, 20], 'maximum')).toBe(50);
    expect(reduce([10, 50, 20], 'range')).toBe(40);
    expect(reduce([200, 100], 'sum')).toBe(255);
    expect(reduce([1, 2], 'sum')).toBe(3);
  });
  it('computes moments with population formulas', () => {
    // Values 2, 4, 4, 4, 5, 5, 7, 9: mean 5, variance 4, deviation 2.
    const v = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(reduce(v, 'variance')).toBe(4);
    expect(reduce(v, 'deviation')).toBe(2);
    // Symmetric data has zero skewness (mid-gray); a long right tail is positive.
    expect(reduce([1, 2, 3], 'skewness')).toBe(128);
    expect(reduce([0, 0, 0, 90], 'skewness')).toBeGreaterThan(128);
    // Two-point data has kurtosis 1 (excess -2) → 128 - 64.
    expect(reduce([0, 100, 0, 100], 'kurtosis')).toBe(64);
    // No spread: neutral values, not division by zero.
    expect(reduce([7, 7, 7], 'skewness')).toBe(128);
    expect(reduce([7, 7, 7], 'kurtosis')).toBe(128);
    expect(reduce([7, 7, 7], 'variance')).toBe(0);
  });
  it('scales entropy from agreement (0) to all-different (255)', () => {
    expect(reduce([5, 5, 5, 5], 'entropy')).toBe(0);
    expect(reduce([1, 2, 3, 4], 'entropy')).toBe(255);
    expect(reduce([1, 1, 2, 2], 'entropy')).toBe(128);
    expect(reduce([9], 'entropy')).toBe(0);
  });
  it('reduces each channel over the layers that cover a pixel', () => {
    const px = (r: number, g: number, b: number, a: number) => [r, g, b, a];
    const a = Uint8ClampedArray.from([...px(10, 0, 0, 255), ...px(0, 0, 0, 0)]);
    const b = Uint8ClampedArray.from([...px(30, 100, 0, 128), ...px(0, 0, 0, 0)]);
    const c = Uint8ClampedArray.from([...px(200, 50, 9, 255), ...px(40, 60, 80, 90)]);
    const median = stackLayers([a, b, c], 2, 'median');
    expect(Array.from(median.slice(0, 4))).toEqual([30, 50, 0, 255]);
    // Only one layer covers the second pixel; transparent layers are ignored.
    expect(Array.from(median.slice(4, 8))).toEqual([40, 60, 80, 90]);
    const none = stackLayers([new Uint8ClampedArray(4), new Uint8ClampedArray(4)], 1, 'mean');
    expect(Array.from(none)).toEqual([0, 0, 0, 0]);
  });
});

describe('embedded object placement', () => {
  const base = { x: 10, y: 20, width: 100, height: 50, rotation: 0 };
  it('composes rectangle edits with a stored frame exactly', () => {
    const quad: [number, number][] = [[10, 20], [110, 30], [100, 70], [15, 70]];
    const l = { transform: { ...base }, embed: { contents: 'c', frame: { quad, rect: { x: 10, y: 20, width: 100, height: 50 }, source: 'a' } } };
    expect(effectiveFrame(l)!.quad.map((p) => [p.x, p.y])).toEqual(quad);
    // Moving the layer moves the frame; doubling its size doubles the frame about the origin of the rect.
    l.transform = { x: 30, y: 20, width: 200, height: 100, rotation: 0 };
    const q = effectiveFrame(l)!.quad;
    expect(q[0].x).toBeCloseTo(30);
    expect(q[0].y).toBeCloseTo(20);
    expect(q[1].x).toBeCloseTo(230);
    expect(q[1].y).toBeCloseTo(40);
    expect(q[2].y).toBeCloseTo(120);
  });
  it('detects stale caches: new content, scale or rotation, sub-pixel moves', () => {
    const frame = { quad: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][], rect: { x: 0, y: 0, width: 10, height: 10 }, source: 'a' };
    const l = { transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, embed: { contents: 'c', frame } };
    expect(frameStale(l, 'a')).toBe(false);
    expect(frameStale(l, 'b')).toBe(true);
    expect(frameStale({ ...l, transform: { ...l.transform, x: 5 } }, 'a')).toBe(false);
    expect(frameStale({ ...l, transform: { ...l.transform, x: 5.5 } }, 'a')).toBe(true);
    expect(frameStale({ ...l, transform: { ...l.transform, width: 12 } }, 'a')).toBe(true);
    expect(frameStale({ ...l, transform: { ...l.transform, rotation: 15 } }, 'a')).toBe(true);
    expect(frameStale({ transform: l.transform }, 'a')).toBe(false);
  });
  it('keeps rotated rectangles as plain transforms and frames everything else', () => {
    const t = { x: 0, y: 0, width: 40, height: 20, rotation: 30 };
    const plain = plainPlacement(transformQuad(t), undefined)!;
    expect(plain.rotation).toBeCloseTo(30);
    expect(plain.width).toBeCloseTo(40);
    const mirrored = transformQuad({ ...t, rotation: 0 });
    expect(plainPlacement([mirrored[1], mirrored[0], mirrored[3], mirrored[2]], undefined)).toBeUndefined();
    const skewed = transformQuad({ ...t, rotation: 0 });
    skewed[1] = { x: skewed[1].x + 5, y: skewed[1].y };
    expect(plainPlacement(skewed, undefined)).toBeUndefined();
    const { frame, rect } = pendingFrame(skewed, undefined);
    expect(rect).toEqual({ x: 0, y: 0, width: 45, height: 20 });
    expect(frame.source).toBe('');
    // Unframed instances report their rectangle's corners.
    expect(instanceQuad({ transform: { ...t, rotation: 0 } })[2]).toEqual({ x: 40, y: 20 });
  });
  it('keeps the scale of an instance when its content size changes', () => {
    const t = rescaleTransform({ x: 0, y: 0, width: 50, height: 50, rotation: 10 }, { width: 100, height: 100 }, { width: 200, height: 100 });
    expect(t).toEqual({ x: -25, y: 0, width: 100, height: 50, rotation: 10 });
  });
  it('keeps the scale of a framed (flipped) instance when its content size changes', () => {
    // Content 60 × 40 shown mirrored at (100, 40); it grows to 80 × 40.
    const f = { quad: [[160, 40], [100, 40], [100, 80], [160, 80]] as [number, number][], rect: { x: 100, y: 40, width: 60, height: 40 }, source: 'a' };
    const next = rescaleFrame(f, { width: 60, height: 40 }, { width: 80, height: 40 });
    expect(next.quad.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[170, 40], [90, 40], [90, 80], [170, 80]]);
    expect(next.rect).toEqual(f.rect);
    // Meshes keep their placement.
    const mesh = { ...f, mesh: { cols: 2, rows: 2, points: [160, 40, 100, 40, 160, 80, 100, 80] } };
    expect(rescaleFrame(mesh, { width: 60, height: 40 }, { width: 80, height: 40 })).toBe(mesh);
  });
});

/** A document with one embedded object drawn by two instances. */
async function sample() {
  const assets = new Assets();
  const nested = newDocument(4, 3, 'Inner');
  nested.layers.push(layer('text', 'Title', 4, 3));
  const project = await serialize(nested, new Assets());
  const projectId = await assets.add(new Blob([project], { type: projectMimeType }));
  const composite = await assets.addRaster({ width: 4, height: 3, data: new Uint16Array(4 * 3 * 4) });
  const c: EmbeddedContents = { id: 'contents-1', name: 'Inner', width: 4, height: 3, project: projectId, composite, colorSpace: 'document', stack: 'median', link: { kind: 'puter', name: 'inner.photo', path: '/u/inner.photo', size: 10, modified: 1, hash: 'a'.repeat(64) } };
  const doc = newDocument(20, 20, 'Parent');
  doc.embeds = { [c.id]: c };
  for (const name of ['One', 'Two']) {
    const l = layer('image', name, 4, 3);
    l.asset = composite;
    l.assetColorSpace = 'document';
    l.embed = { contents: c.id };
    doc.layers.push(l);
  }
  doc.layers[1].embed!.frame = { quad: [[0, 0], [4, 1], [4, 3], [0, 3]], mesh: { cols: 2, rows: 2, points: [0, 0, 4, 1, 0, 3, 4, 3] }, rect: { x: 0, y: 0, width: 4, height: 3 }, source: composite };
  return { doc, assets, c };
}

describe('embedded object model', () => {
  it('round-trips shared contents, links, stack modes and frames through .photo', async () => {
    const { doc, assets, c } = await sample();
    const loaded = await deserialize(await serialize(doc, assets));
    expect(loaded.document.embeds).toEqual(doc.embeds);
    expect(loaded.document.layers.map((l) => l.embed)).toEqual(doc.layers.map((l) => l.embed));
    expect(instancesOf(loaded.document, c.id)).toHaveLength(2);
    // The nested project is itself a valid project.
    const inner = await deserialize(loaded.assets.blob(c.project!));
    expect(inner.document.name).toBe('Inner');
    expect(inner.document.layers[0].kind).toBe('text');
  });
  it('drops contents no layer uses when saving', async () => {
    const { doc, assets, c } = await sample();
    doc.embeds!.orphan = { ...copyContents(c), id: 'orphan' };
    expect(Object.keys(usedEmbeds(doc)!)).toEqual([c.id]);
    const loaded = await deserialize(await serialize(doc, assets));
    expect(Object.keys(loaded.document.embeds!)).toEqual([c.id]);
    doc.layers = [];
    expect(usedEmbeds(doc)).toBeUndefined();
  });
  it('rejects malformed embedded objects', async () => {
    const { doc } = await sample();
    const bad = (edit: (d: PhotoDocument) => void) => {
      const d = structuredClone(doc);
      edit(d);
      return () => validateDocument(d);
    };
    expect(bad(() => {})).not.toThrow();
    expect(bad((d) => (d.layers[0].embed!.contents = 'missing'))).toThrow('embedded object layer');
    expect(bad((d) => (d.layers[0].kind = 'pixel'))).toThrow();
    expect(bad((d) => (d.embeds!['contents-1'].width = 0))).toThrow('contents');
    expect(bad((d) => (d.embeds!['contents-1'].stack = 'loudest' as 'mean'))).toThrow('contents');
    expect(bad((d) => (d.embeds!['contents-1'].link!.hash = 'nope'))).toThrow('linked');
    expect(bad((d) => (d.layers[1].embed!.frame!.quad = [[0, 0]]))).toThrow('frame');
    expect(bad((d) => (d.layers[1].embed!.frame!.mesh!.points = [1, 2]))).toThrow('warp');
    expect(bad((d) => (d.layers[1].liveMaskDisabled = true))).toThrow('Live Filters');
  });
  it('checks embedded assets when loading', async () => {
    const { doc, assets } = await sample();
    const d = structuredClone(doc);
    d.embeds!['contents-1'].width = 5;
    await expect(deserialize(await serialize(d, assets))).rejects.toThrow('size');
    expect(() => validateEmbeds({ ...newDocument(), embeds: [] as unknown as PhotoDocument['embeds'] })).toThrow();
  });
  it('shares contents between duplicates and separates copies; undo restores', async () => {
    const { doc, c } = await sample();
    const h = new History(doc);
    h.execute('Duplicate', (d) => d.layers.push({ ...structuredClone(d.layers[0]), id: 'dup' }));
    expect(instancesOf(h.document, c.id)).toHaveLength(3);
    h.execute('Via Copy', (d) => {
      const copy = copyContents(d.embeds![c.id]);
      d.embeds![copy.id] = copy;
      d.layers.push({ ...structuredClone(d.layers[0]), id: 'copy', embed: { contents: copy.id } });
    });
    expect(instancesOf(h.document, c.id)).toHaveLength(3);
    expect(Object.keys(h.document.embeds!)).toHaveLength(2);
    h.undo();
    h.undo();
    expect(h.document).toBe(doc);
  });
  it('loads a project into an existing asset store without duplicating assets', async () => {
    const { doc, assets } = await sample();
    const blob = await serialize(doc, assets);
    const target = new Assets();
    const loaded = await deserialize(blob, target);
    expect(loaded.assets).toBe(target);
    // Loading again keeps the assets that are already present.
    await deserialize(blob, target);
    expect(target.has(doc.embeds!['contents-1'].composite)).toBe(true);
  });
});
