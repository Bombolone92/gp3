import { describe, expect, it } from 'vitest';
import { alternates, defaultWebSettings, describeSettings, downloadSeconds, formatSeconds, scalePieces } from '../src/features/layout/export-web';
import { guideCells } from '../src/features/layout/slices';
import { partitionSlices } from '../src/model/slices';
import { newDocument } from '../src/model/document';

describe('Export for Web helpers', () => {
  it('describes settings and proposes alternates for 4-Up', () => {
    const jpeg = { ...defaultWebSettings, format: 'jpeg' as const, quality: 80 };
    expect(describeSettings(jpeg)).toBe('JPEG 80');
    expect(describeSettings(defaultWebSettings)).toBe('PNG');
    expect(describeSettings({ ...defaultWebSettings, format: 'gif', colors: 64 })).toBe('GIF 64 colors');
    const [lower, other] = alternates(jpeg);
    expect(lower).toMatchObject({ format: 'jpeg', quality: 48 });
    expect(other).toMatchObject({ format: 'webp', quality: 80 });
    expect(alternates(defaultWebSettings).map((s) => s.format)).toEqual(['gif', 'webp']);
    expect(alternates({ ...defaultWebSettings, format: 'gif', colors: 6 })[0].colors).toBe(2);
  });
  it('estimates download time', () => {
    expect(downloadSeconds(1_000_000)).toBe(1);
    expect(formatSeconds(0.05)).toBe('< 0.1 s');
    expect(formatSeconds(2.345)).toBe('2.3 s');
    expect(formatSeconds(42.4)).toBe('42 s');
  });
  it('scales pieces onto shared cut lines without gaps', () => {
    const doc = { ...newDocument(301, 201), slices: [{ id: 's', rect: { x: 101, y: 51, width: 99, height: 99 } }] };
    const pieces = scalePieces(partitionSlices(doc), 1 / 3);
    const area = pieces.reduce((sum, p) => sum + p.rect.width * p.rect.height, 0);
    expect(area).toBe(100 * 67);
    for (const p of pieces) for (const q of pieces)
      if (p !== q) expect(p.rect.x < q.rect.x + q.rect.width && q.rect.x < p.rect.x + p.rect.width && p.rect.y < q.rect.y + q.rect.height && q.rect.y < p.rect.y + p.rect.height).toBe(false);
  });
});

describe('slices from guides', () => {
  it('makes one cell per guide grid cell, ignoring guides outside the canvas', () => {
    const cells = guideCells(300, 200, [
      { orientation: 'vertical', position: 100 },
      { orientation: 'vertical', position: 400 },
      { orientation: 'horizontal', position: 50.4 },
    ]);
    expect(cells).toEqual([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 100, y: 0, width: 200, height: 50 },
      { x: 0, y: 50, width: 100, height: 150 },
      { x: 100, y: 50, width: 200, height: 150 },
    ]);
  });
});
