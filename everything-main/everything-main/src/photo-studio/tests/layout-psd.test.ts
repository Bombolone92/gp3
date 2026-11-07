import { describe, expect, it } from 'vitest';
import { readPsd } from 'ag-psd';
import { layer, newDocument } from '../src/model/document';
import { createArtboard } from '../src/model/artboard';
import { createFrame } from '../src/model/frame';
import { savePsd } from '../src/model/psd';
import { exportPsdArtboard, importPsdArtboard } from '../src/model/psd-artboard';

describe('PSD artboards', () => {
  it('writes artboard groups with their rectangle and background', async () => {
    const doc = newDocument(120, 80);
    const a = createArtboard(doc, { x: 10, y: 5, width: 60, height: 70 }, { background: 'custom', color: '#336699' });
    const child = layer('solid', 'Fill', 10, 10);
    child.transform = { x: 20, y: 20, width: 10, height: 10, rotation: 0 };
    a.children = [child];
    const f = createFrame(doc, { x: 80, y: 10, width: 30, height: 30 }, 'ellipse');
    doc.layers = [a, f];
    const blob = await savePsd(doc, async () => new Uint8Array(120 * 80 * 4));
    const psd = readPsd(new Uint8Array(await blob.arrayBuffer()), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
    expect(psd.artboards?.count).toBe(1);
    const [board, frame] = psd.children!;
    expect(board.name).toBe('Artboard 1');
    expect(board.artboard?.rect).toEqual({ top: 5, left: 10, bottom: 75, right: 70 });
    expect(board.artboard?.backgroundType).toBe(4);
    expect(board.children).toHaveLength(1);
    // Frames export as their rendered (masked) pixels.
    expect(frame.children).toBeUndefined();
    expect(importPsdArtboard(board.artboard!)).toEqual({ rect: { x: 10, y: 5, width: 60, height: 70 }, background: 'custom', clip: true, color: '#336699' });
  });
  it('maps background types both ways and rejects empty rectangles', () => {
    for (const background of ['white', 'black', 'transparent'] as const) {
      const data = { rect: { x: 0, y: 0, width: 5, height: 6 }, background, clip: true };
      expect(importPsdArtboard(exportPsdArtboard(data))).toEqual(data);
    }
    expect(importPsdArtboard({ rect: { top: 0, left: 0, bottom: 0, right: 5 } })).toBeUndefined();
  });
});
