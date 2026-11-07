import { describe, expect, it } from 'vitest';
import { allLayers, cropDocument, findLayer, newDocument, resizeDocument, type PhotoDocument } from '../src/model/document';
import { History } from '../src/history/history';
import { commitPixelTranslation, newPixelLayer, pixelTransformKind } from '../src/model/pixel-layer';
import { TileStore, gridDocBounds, gridFromImage, readRGBA, writeRect } from '../src/model/tiles';
import { validateDocument } from '../src/model/serialization';
import { applyMat3, type Mat3 } from '../src/imaging/filters/warp';
import { duplicateFrame, footageVideo, isIdentity, matrixOfMap, placementOf, transformVideo, insertBlankFrame } from '../src/model/video-layer';
import { createTimeline, syncTimeline, type FrameLookup } from '../src/model/video-timeline';
import { applyTime, resamplePlacer } from '../src/model/video-timeline-ops';
import { mapDocumentGeometry } from '../src/model/document';

const store = new TileStore();
const scale = (sx: number, sy = sx): Mat3 => [sx, 0, 0, 0, sy, 0, 0, 0, 1];
const rot90: Mat3 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
function block(rgb: [number, number, number], w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width: w, height: h, data };
}
const near = (a: Mat3 | undefined, b: Mat3) => expect(a!.map((v, i) => Math.abs(v / a![8] - b[i]) < 1e-9)).toEqual(b.map(() => true));

describe('video placement math', () => {
  const v = () => ({ ...footageVideo({ asset: 'a', name: 'f', type: 'video/webm', width: 16, height: 8, frames: 4, fps: 10 }, 10, 20), altered: { 1: gridFromImage(store, block([1, 2, 3], 4, 4)) } });

  it('keeps moves in the origin and composes other transforms into the frame matrices', () => {
    const moved = transformVideo(v(), [1, 0, 5, 0, 1, -3, 0, 0, 1]);
    expect(moved).toMatchObject({ x: 15, y: 17 });
    expect(moved.matrix).toBeUndefined();
    expect(moved.alteredMatrix).toBeUndefined();
    // Scaling by 2 about the document origin: the origin doubles, frames scale.
    const big = transformVideo(v(), scale(2));
    expect(big).toMatchObject({ x: 20, y: 40 });
    near(big.matrix, scale(2));
    near(big.alteredMatrix![1], scale(2));
    // Then a quarter turn: matrices compose; the document matrix of a frame
    // equals the composition of the transforms.
    const turned = transformVideo(big, rot90);
    near(placementOf(turned, false), [0, -2, -40, 2, 0, 20, 0, 0, 1]);
    near(placementOf(turned, true, 1), [0, -2, -40, 2, 0, 20, 0, 0, 1]);
    // Fractional origins are rounded; the rest stays in the matrix.
    const half = transformVideo({ ...v(), x: 3, y: 3 }, scale(0.5));
    expect(half).toMatchObject({ x: 2, y: 2 });
    const p = applyMat3(placementOf(half, false), 4, 4);
    expect([p.x, p.y]).toEqual([3.5, 3.5]);
    expect(isIdentity([2, 0, 0, 0, 2, 0, 0, 0, 2])).toBe(true);
  });

  it('fits affine and projective point maps exactly', () => {
    const affine = matrixOfMap((x, y) => [0.5 * x - 0.25 * y + 3, 0.25 * x + 0.5 * y - 7], 100, 80);
    near(affine, [0.5, -0.25, 3, 0.25, 0.5, -7, 0, 0, 1]);
    const h: Mat3 = [1.2, 0.1, 5, -0.05, 0.9, 2, 0.001, 0.0005, 1];
    const fitted = matrixOfMap((x, y) => {
      const q = applyMat3(h, x, y);
      return [q.x, q.y];
    }, 200, 100);
    const q = applyMat3(fitted, 37, 81),
      r = applyMat3(h, 37, 81);
    expect(q.x).toBeCloseTo(r.x, 6);
    expect(q.y).toBeCloseTo(r.y, 6);
  });

  it('shifts altered frame matrices with frame edits', () => {
    const x = transformVideo(v(), scale(2));
    insertBlankFrame(x, 0);
    expect(Object.keys(x.alteredMatrix!)).toEqual(['2']);
    duplicateFrame(x, 2);
    expect(Object.keys(x.alteredMatrix!)).toEqual(['2', '3']);
  });
});

describe('video placement in documents', () => {
  /** A 4-frame footage layer (solid colors, 16 x 8) with frame 1 painted. */
  function fixture() {
    const doc = newDocument(64, 48);
    const colors: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    const grids = colors.map((c) => gridFromImage(store, block(c, 16, 8)));
    const l = newPixelLayer('Clip', doc, { ...grids[0], x: 8, y: 8 });
    l.video = footageVideo({ asset: 'a', name: 'c', type: 'video/webm', width: 16, height: 8, frames: 4, fps: 10 }, 8, 8);
    doc.layers = [l];
    doc.timeline = createTimeline(10, 0.4);
    const lookup: FrameLookup = (_l, _k, j) => grids[j];
    lookup.place = resamplePlacer(store, 'nearest');
    const h = new History(doc);
    h.normalize = (d, before) => {
      for (const x of allLayers(d.layers)) if (x.kind === 'pixel' && pixelTransformKind(x) === 'translate') commitPixelTranslation(x);
      syncTimeline(d, before);
    };
    h.execute('Time', (d) => applyTime(d, 1, lookup));
    h.execute('Paint', (d) => {
      const x = findLayer(d.layers, l.id)!;
      x.pixels = writeRect(store, x.pixels!, 8, 8, block([9, 9, 9], 4, 4));
    });
    return { h, id: l.id, lookup };
  }
  const bounds = (doc: PhotoDocument, id: string) => gridDocBounds(findLayer(doc.layers, id)!.pixels!);
  const pixel = (doc: PhotoDocument, id: string, x: number, y: number) => Array.from(readRGBA(store, findLayer(doc.layers, id)!.pixels!, { x, y, width: 1, height: 1 }).data);

  it('carries every frame through Image Size, canvas rotation and crops', () => {
    const { h, id, lookup } = fixture();
    // Image Size 50 %: the document map halves every frame.
    h.execute('Image Size', (d) => resizeDocument(d, 32, 24));
    expect(findLayer(h.document.layers, id)!.video).toMatchObject({ x: 4, y: 4 });
    // A quarter turn of the canvas (24 high becomes the width).
    h.execute('Rotate Canvas', (d) => {
      d.width = 24;
      d.height = 32;
      mapDocumentGeometry(d, (x, y) => [24 - y, x]);
    });
    // Crop 2 pixels off the left and top.
    h.execute('Crop', (d) => cropDocument(d, { x: 2, y: 2, width: 22, height: 30 }));
    const shown = (t: number) => {
      h.execute('Time', (d) => applyTime(d, t, lookup));
      return bounds(h.document, id);
    };
    // Every frame, painted or not, lands on the same 4 x 8 area.
    const expected = { x: 14, y: 2, width: 4, height: 8 };
    expect(shown(0)).toEqual(expected);
    expect(shown(1)).toEqual(expected);
    expect(shown(3)).toEqual(expected);
    expect(pixel(h.document, id, 15, 3)).toEqual([255, 255, 0, 255]);
    // The painted corner of frame 1 turned with it: top-right after the turn.
    shown(1);
    expect(pixel(h.document, id, 17, 2)).toEqual([9, 9, 9, 255]);
    expect(pixel(h.document, id, 14, 9)).toEqual([0, 255, 0, 255]);
    // Undo restores the untransformed placement of every frame.
    while (h.canUndo && findLayer(h.document.layers, id)!.video!.matrix) h.undo();
    expect(findLayer(h.document.layers, id)!.video).toMatchObject({ x: 8, y: 8 });
    // Saved projects keep the matrices.
    h.redo();
    expect(() => validateDocument(structuredClone(h.document))).not.toThrow();
    const bad = structuredClone(h.document);
    bad.layers[0].video!.matrix = [1, 2, 3] as unknown as Mat3;
    expect(() => validateDocument(bad)).toThrow(/video layer/);
  });

  it('stores painting on a transformed frame in document space', () => {
    const { h, id, lookup } = fixture();
    h.execute('Image Size', (d) => resizeDocument(d, 128, 96));
    expect(findLayer(h.document.layers, id)!.video!.alteredMatrix).toBeDefined();
    h.execute('Time', (d) => applyTime(d, 1, lookup));
    h.execute('Paint', (d) => {
      const x = findLayer(d.layers, id)!;
      x.pixels = writeRect(store, x.pixels!, 40, 20, block([7, 7, 7], 2, 2));
    });
    const v = findLayer(h.document.layers, id)!.video!;
    expect(v.alteredMatrix).toBeUndefined();
    h.execute('Time', (d) => applyTime(d, 0, lookup));
    h.execute('Time', (d) => applyTime(d, 1, lookup));
    expect(pixel(h.document, id, 40, 20)).toEqual([7, 7, 7, 255]);
    expect(bounds(h.document, id)).toEqual({ x: 16, y: 16, width: 32, height: 16 });
  });
});
