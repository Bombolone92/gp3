import { describe, it, expect, beforeAll } from 'vitest';
import { inflateSync } from 'node:zlib';
import { installCanvasStub, bootAppWithFeatures } from './helpers.js';
import { VDocument } from '../src/model/document.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { transformNodes } from '../src/model/geometry.js';
import { translate } from '../src/lib/matrix.js';
import {
  autoSlices,
  sliceTable,
  sliceAt,
  addSlice,
  slicesOf,
  pixelRect,
  divideRect,
  divideSlices,
  combineSlices,
  duplicateSlices,
  slicesFromGuides,
  makeObjectSlices,
  sliceRect,
  defaultSliceName,
  promote,
} from '../src/features/slices/model.js';
import { quantize, encodeGIF, encodePNG8, interlacedRows, indexedToRgba, makePalette, flatten, zlib } from '../src/features/slices/encode.js';
import { slicesHtml, exportRows, sliceFileName, settingsFor, DEFAULT_SETTINGS } from '../src/features/slices/save-for-web.js';
import { dragRect, setSliceSelection, selectedSlices } from '../src/features/slices/tools.js';

beforeAll(() => installCanvasStub());

const solid = (color) => ({ type: 'solid', color });

function docWith(slices = [], { width = 100, height = 100 } = {}) {
  const doc = VDocument.create({ width, height, name: 'Banner' });
  doc.transact('slices', () => {
    for (const s of slices) addSlice(doc, s);
  });
  return doc;
}

/** Minimal GIF decoder (first image, no extensions beyond the graphic control block) for round trips. */
function decodeGIF(bytes) {
  let p = 6;
  const u16 = () => bytes[p++] | (bytes[p++] << 8);
  const width = u16();
  const height = u16();
  const packed = bytes[p++];
  p += 2;
  const gct = 1 << ((packed & 7) + 1);
  const palette = [];
  for (let i = 0; i < gct; i++) palette.push([bytes[p++], bytes[p++], bytes[p++]]);
  let transparent = -1;
  if (bytes[p] === 0x21 && bytes[p + 1] === 0xf9) {
    transparent = bytes[p + 3] & 1 ? bytes[p + 6] : -1;
    p += 8;
  }
  expect(bytes[p++]).toBe(0x2c);
  p += 8;
  const interlaced = Boolean(bytes[p++] & 0x40);
  const minCode = bytes[p++];
  const data = [];
  for (let n = bytes[p++]; n; n = bytes[p++]) for (let i = 0; i < n; i++) data.push(bytes[p++]);
  expect(bytes[p]).toBe(0x3b);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCode + 1;
  };
  reset();
  let bit = 0;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, bit++) v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    return v;
  };
  const out = [];
  let prev = null;
  for (;;) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else entry = [...prev, prev[0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  let indices = out;
  if (interlaced) {
    indices = new Array(out.length);
    interlacedRows(height).forEach((y, i) => {
      for (let x = 0; x < width; x++) indices[y * width + x] = out[i * width + x];
    });
  }
  return { width, height, palette, transparent, indices };
}

describe('slice geometry', () => {
  it('snaps user slices to whole units', () => {
    expect(pixelRect({ x: 0.4, y: 1.6, w: 10.2, h: 3 })).toEqual({ x: 0, y: 1, w: 11, h: 4 });
  });

  it('fills the rest of the area with auto slices', () => {
    const area = { x: 0, y: 0, w: 100, h: 100 };
    // One slice in the middle: a band above, the left/right pieces beside it, a band below.
    const autos = autoSlices(area, [{ x: 20, y: 30, w: 40, h: 20 }]);
    expect(autos).toEqual([
      { x: 0, y: 0, w: 100, h: 30 },
      { x: 0, y: 30, w: 20, h: 20 },
      { x: 60, y: 30, w: 40, h: 20 },
      { x: 0, y: 50, w: 100, h: 50 },
    ]);
    const total = autos.reduce((s, r) => s + r.w * r.h, 0) + 40 * 20;
    expect(total).toBe(100 * 100);
    expect(autoSlices(area, [])).toEqual([area]);
    // Overlapping slices are treated as their union; stacked identical columns merge.
    const two = autoSlices(area, [{ x: 0, y: 0, w: 50, h: 40 }, { x: 0, y: 30, w: 50, h: 70 }]);
    expect(two).toEqual([{ x: 50, y: 0, w: 50, h: 100 }]);
  });

  it('numbers slices in reading order across user and auto slices', () => {
    const doc = docWith([{ kind: 'user', x: 50, y: 0, w: 50, h: 50 }, { kind: 'user', x: 0, y: 50, w: 50, h: 50 }]);
    const table = sliceTable(doc);
    expect(table.map((r) => [r.kind, r.rect.x, r.rect.y, r.number])).toEqual([
      ['auto', 0, 0, 1],
      ['user', 50, 0, 2],
      ['user', 0, 50, 3],
      ['auto', 50, 50, 4],
    ]);
    expect(sliceAt(table, 60, 10).kind).toBe('user');
    expect(sliceAt(table, 10, 10).kind).toBe('auto');
    expect(sliceAt(table, 500, 500)).toBeNull();
  });

  it('clips slices to the artboard unless clipping is off', () => {
    const doc = docWith([{ kind: 'user', x: 80, y: 80, w: 50, h: 50 }]);
    expect(sliceTable(doc).find((r) => r.kind === 'user').rect).toEqual({ x: 80, y: 80, w: 20, h: 20 });
    doc.transact('clip', () => doc.updateRoot({ sliceClip: false }));
    expect(sliceTable(doc).find((r) => r.kind === 'user').rect).toEqual({ x: 80, y: 80, w: 50, h: 50 });
  });

  it('keeps object slices on their objects', () => {
    const doc = docWith();
    const r = createPath(rectangle(10, 10, 20, 20), true, { fill: solid('#ff0000'), stroke: null });
    doc.transact('add', () => doc.insert(r, doc.layers()[0].id));
    doc.transact('make', () => makeObjectSlices(doc, [r.id]));
    // A second Make adds nothing for the same object.
    doc.transact('again', () => expect(makeObjectSlices(doc, [r.id])).toEqual([]));
    const s = slicesOf(doc)[0];
    expect(sliceRect(doc, s)).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    doc.transact('move', () => transformNodes(doc, [r.id], translate(5, 0)));
    expect(sliceRect(doc, s)).toEqual({ x: 15, y: 10, w: 20, h: 20 });
    doc.transact('delete', () => doc.remove(r.id));
    expect(sliceTable(doc).every((row) => row.kind === 'auto')).toBe(true);
    doc.undo();
    expect(sliceTable(doc).some((row) => row.kind === 'object')).toBe(true);
  });

  it('divides, combines, duplicates and makes slices from guides', () => {
    expect(divideRect({ x: 0, y: 0, w: 100, h: 50 }, { count: 4 }, { count: 2 }).length).toBe(8);
    expect(divideRect({ x: 0, y: 0, w: 100, h: 50 }, { size: 30 }, { count: 1 }).map((r) => r.w)).toEqual([30, 30, 30, 10]);
    const doc = docWith([{ kind: 'user', x: 0, y: 0, w: 40, h: 40, name: 'Logo', url: 'https://example.com' }]);
    const id = slicesOf(doc)[0].id;
    let cells;
    doc.transact('divide', () => {
      cells = divideSlices(doc, [id], { count: 2 }, { count: 2 });
    });
    expect(cells.length).toBe(4);
    expect(slicesOf(doc).map((s) => [s.x, s.y, s.w, s.h])).toEqual([[0, 0, 20, 20], [20, 0, 20, 20], [0, 20, 20, 20], [20, 20, 20, 20]]);
    let combined;
    doc.transact('combine', () => {
      combined = combineSlices(doc, cells);
    });
    expect(slicesOf(doc).length).toBe(1);
    expect(slicesOf(doc)[0]).toMatchObject({ id: combined, x: 0, y: 0, w: 40, h: 40 });
    let dup;
    doc.transact('dup', () => {
      dup = duplicateSlices(doc, [combined]);
    });
    expect(slicesOf(doc).find((s) => s.id === dup[0])).toMatchObject({ x: 10, y: 10, w: 40, h: 40 });
    doc.transact('guides', () => doc.updateRoot({ guides: [{ axis: 'x', pos: 30 }, { axis: 'y', pos: 60 }] }));
    doc.transact('from guides', () => slicesFromGuides(doc, doc.artboards[0]));
    expect(slicesOf(doc).map((s) => [s.x, s.y, s.w, s.h])).toEqual([[0, 0, 30, 60], [30, 0, 70, 60], [0, 60, 30, 40], [30, 60, 70, 40]]);
  });

  it('promotes auto slices to user slices', () => {
    const doc = docWith([{ kind: 'user', x: 0, y: 0, w: 50, h: 100 }]);
    const auto = sliceTable(doc).find((r) => r.kind === 'auto');
    let id;
    doc.transact('promote', () => {
      id = promote(doc, auto);
    });
    expect(slicesOf(doc).find((s) => s.id === id)).toMatchObject({ kind: 'user', x: 50, y: 0, w: 50, h: 100 });
  });

  it('names slices after the document', () => {
    expect(defaultSliceName(docWith(), 3)).toBe('Banner_03');
  });

  it('draws slices from drags with Shift and Alt', () => {
    expect(dragRect(10, 10, 30, 20)).toEqual({ x: 10, y: 10, w: 20, h: 10 });
    expect(dragRect(10, 10, 30, 20, { shift: true })).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(dragRect(10, 10, 30, 20, { alt: true })).toEqual({ x: -10, y: 0, w: 40, h: 20 });
  });
});

describe('web image encoders', () => {
  const pixels = (w, h, fn) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(fn(x, y), (y * w + x) * 4);
    return out;
  };

  it('keeps exact colors when they fit and reserves an index for transparency', () => {
    const px = pixels(4, 4, (x) => (x === 0 ? [0, 0, 0, 0] : x === 1 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const q = quantize(px, 4, 4, { colors: 8 });
    expect(q.transparent).toBe(2);
    expect(q.palette.slice(0, 2)).toEqual([[255, 0, 0], [0, 0, 255]]);
    expect(q.indices[0]).toBe(q.transparent);
    expect(q.palette[q.indices[1]]).toEqual([255, 0, 0]);
    const rgba = indexedToRgba(q);
    expect([...rgba.slice(0, 8)]).toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
  });

  it('reduces gradients with median cut, and dithering spreads the error', () => {
    const w = 64;
    const px = pixels(w, 4, (x) => [x * 4, 255 - x * 4, 128, 255]);
    const plain = quantize(px, w, 4, { colors: 8, dither: 0, transparency: false });
    expect(plain.palette.length).toBeLessThanOrEqual(8);
    expect(plain.transparent).toBe(-1);
    const dithered = quantize(px, w, 4, { colors: 8, dither: 1, transparency: false });
    // Dithering mixes neighbouring palette entries along the ramp.
    const changes = (q) => q.indices.slice(0, w).reduce((n, v, i, a) => n + (i && v !== a[i - 1] ? 1 : 0), 0);
    expect(changes(dithered)).toBeGreaterThan(changes(plain));
    const perceptual = makePalette(flatten(px).rgb, flatten(px).clear, { colors: 4, method: 'perceptual' });
    expect(perceptual.length).toBe(4);
  });

  it('builds fixed palettes', () => {
    const { rgb, clear } = flatten(new Uint8ClampedArray([10, 200, 30, 255]));
    expect(makePalette(rgb, clear, { method: 'bw' })).toEqual([[0, 0, 0], [255, 255, 255]]);
    expect(makePalette(rgb, clear, { method: 'grayscale', colors: 3 })).toEqual([[0, 0, 0], [128, 128, 128], [255, 255, 255]]);
    expect(makePalette(rgb, clear, { method: 'web', colors: 256 }).length).toBe(216);
    expect(makePalette(rgb, clear, { method: 'web', colors: 4 })).toEqual([[0, 204, 51]]);
  });

  it('blends partial transparency onto the matte', () => {
    const { rgb, clear } = flatten(new Uint8ClampedArray([0, 0, 0, 191, 0, 0, 0, 10]), { transparency: true, matte: '#ffffff' });
    expect(clear[1]).toBe(1);
    expect(rgb[0]).toBe(64);
  });

  it('writes GIFs that decode to the same pixels (plain and interlaced)', () => {
    const w = 37;
    const h = 23;
    const px = pixels(w, h, (x, y) => (x === y ? [0, 0, 0, 0] : [(x * 7) % 256, (y * 11) % 256, ((x + y) * 5) % 256, 255]));
    const q = quantize(px, w, h, { colors: 64 });
    for (const interlace of [false, true]) {
      const bytes = encodeGIF(w, h, q, { interlace });
      expect(String.fromCharCode(...bytes.slice(0, 6))).toBe('GIF89a');
      const g = decodeGIF(bytes);
      expect(g.width).toBe(w);
      expect(g.height).toBe(h);
      expect(g.transparent).toBe(q.transparent);
      expect(g.indices).toEqual([...q.indices]);
    }
  });

  it('handles long runs past the 12-bit code table', () => {
    const w = 300;
    const h = 200;
    const q = { palette: [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0]], indices: new Uint8Array(w * h).map((_, i) => (i * 7 + (i >> 5)) % 4), transparent: -1 };
    expect(decodeGIF(encodeGIF(w, h, q)).indices).toEqual([...q.indices]);
  });

  it('writes palette PNGs with tRNS', async () => {
    const q = { palette: [[255, 0, 0], [0, 0, 255], [0, 0, 0]], indices: new Uint8Array([0, 1, 2, 0, 1, 2]), transparent: 2 };
    const png = await encodePNG8(3, 2, q);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const text = Buffer.from(png).toString('latin1');
    expect(text).toContain('PLTE');
    expect(text).toContain('tRNS');
    const i = text.indexOf('IDAT');
    const len = new DataView(png.buffer).getUint32(i - 4);
    const raw = inflateSync(png.subarray(i + 4, i + 4 + len));
    expect([...raw]).toEqual([0, 0, 1, 2, 0, 0, 1, 2]);
  });

  it('falls back to stored zlib blocks', async () => {
    const saved = globalThis.CompressionStream;
    globalThis.CompressionStream = undefined;
    try {
      const data = new Uint8Array(70000).map((_, i) => i % 251);
      const z = await zlib(data);
      expect([...inflateSync(z)]).toEqual([...data]);
    } finally {
      globalThis.CompressionStream = saved;
    }
  });
});

describe('save for web output', () => {
  it('exports the whole artboard when there are no slices', () => {
    const doc = docWith();
    const { rows } = exportRows(doc, 0);
    expect(rows).toEqual([expect.objectContaining({ id: 'whole', rect: { x: 0, y: 0, w: 100, h: 100 } })]);
    expect(sliceFileName(doc, rows[0], true, 'Poster')).toBe('Poster');
  });

  it('uses per-slice settings over the defaults', () => {
    expect(settingsFor({ slice: { export: { format: 'gif' } } }, { format: 'jpeg', quality: 50 })).toMatchObject({ format: 'gif', quality: 50, colors: DEFAULT_SETTINGS.colors });
  });

  it('writes a page placing the slices with links, alt text and text cells', () => {
    const doc = docWith([{ kind: 'user', x: 0, y: 0, w: 50, h: 100, name: 'Left', url: 'https://example.com/a', alt: 'A "quote"', target: '_blank' }, { kind: 'user', x: 50, y: 0, w: 50, h: 100, type: 'noImage', html: 'Hello <b>', bg: '#ff0000', align: 'center' }]);
    const { area, rows } = exportRows(doc, 0);
    const files = new Map([[rows[0].id, 'images/Left.png']]);
    const html = slicesHtml('Banner', area, rows, files, 2);
    expect(html).toContain('<a class="cell" href="https://example.com/a" target="_blank" style="left:0px;top:0px;width:100px;height:200px">');
    expect(html).toContain('alt="A &quot;quote&quot;"');
    expect(html).toContain('Hello &lt;b&gt;');
    expect(html).toContain('background:#ff0000');
    expect(html).toContain('justify-content:center');
    expect(html).toContain('width: 200px; height: 200px');
  });
});

describe('slice tools and commands', () => {
  async function setup() {
    const app = await bootAppWithFeatures();
    const ed = app.newDocument({ width: 200, height: 100 });
    ed.view.set({ width: 800, height: 600, zoom: 1, panX: 0, panY: 0 });
    return { app, ed, doc: ed.doc };
  }
  const ev = (ed, x, y, extra = {}) => ({ x, y, ...ed.view.toScreen(x, y), sx: ed.view.toScreen(x, y).x, sy: ed.view.toScreen(x, y).y, shift: false, alt: false, mod: false, button: 0, ...extra });

  it('draws user slices with the Slice tool and selects them', async () => {
    const { app, ed, doc } = await setup();
    app.setTool('slice');
    const t = app.tool;
    t.onPointerDown(ev(ed, 10, 10));
    t.onPointerMove(ev(ed, 60.4, 40.2));
    t.onPointerUp(ev(ed, 60.4, 40.2));
    expect(slicesOf(doc)).toEqual([expect.objectContaining({ kind: 'user', x: 10, y: 10, w: 51, h: 31 })]);
    expect([...selectedSlices(ed)]).toEqual([slicesOf(doc)[0].id]);
    expect(ed.viewOptions.slices).toBe(true);
    doc.undo();
    expect(slicesOf(doc)).toEqual([]);
  });

  it('moves, resizes, nudges and deletes slices with the Slice Selection tool', async () => {
    const { app, ed, doc } = await setup();
    doc.transact('s', () => addSlice(doc, { kind: 'user', x: 10, y: 10, w: 40, h: 20 }));
    const id = slicesOf(doc)[0].id;
    app.setTool('slice-select');
    const t = app.tool;
    t.onPointerDown(ev(ed, 20, 20));
    expect([...selectedSlices(ed)]).toEqual([id]);
    t.onPointerMove(ev(ed, 30, 25));
    t.onPointerUp(ev(ed, 30, 25));
    expect(slicesOf(doc)[0]).toMatchObject({ x: 20, y: 15 });
    // Resize from the east handle.
    t.onPointerDown(ev(ed, 60, 25));
    t.onPointerMove(ev(ed, 70, 25));
    t.onPointerUp(ev(ed, 70, 25));
    expect(slicesOf(doc)[0]).toMatchObject({ x: 20, w: 50 });
    expect(t.onKeyDown({ key: 'ArrowRight', shiftKey: true })).toBe(true);
    expect(slicesOf(doc)[0].x).toBe(30);
    // Locked slices do not move.
    ed.setViewOption('lockSlices', true);
    expect(t.onKeyDown({ key: 'ArrowRight', shiftKey: false })).toBe(false);
    ed.setViewOption('lockSlices', false);
    await app.commands.run('edit.clear');
    expect(slicesOf(doc)).toEqual([]);
  });

  it('turns a dragged auto slice into a user slice and Alt-drags copies', async () => {
    const { app, ed, doc } = await setup();
    doc.transact('s', () => addSlice(doc, { kind: 'user', x: 0, y: 0, w: 100, h: 100 }));
    app.setTool('slice-select');
    const t = app.tool;
    t.onPointerDown(ev(ed, 150, 50));
    t.onPointerMove(ev(ed, 150, 60));
    t.onPointerUp(ev(ed, 150, 60));
    expect(slicesOf(doc).length).toBe(2);
    expect(slicesOf(doc)[1]).toMatchObject({ x: 100, y: 10, w: 100, h: 100 });
    t.onPointerDown(ev(ed, 50, 50, { alt: true }));
    t.onPointerMove(ev(ed, 50, 80, { alt: true }));
    t.onPointerUp(ev(ed, 50, 80));
    expect(slicesOf(doc).length).toBe(3);
    expect(slicesOf(doc)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('runs the Object > Slice commands', async () => {
    const { app, ed, doc } = await setup();
    const r = createPath(rectangle(20, 20, 30, 30), true, { fill: solid('#00ff00'), stroke: null });
    doc.transact('add', () => doc.insert(r, doc.layers()[0].id));
    ed.select([r.id]);
    expect(app.commands.isEnabled('slice.make')).toBe(true);
    await app.commands.run('slice.make');
    expect(slicesOf(doc)[0]).toMatchObject({ kind: 'object', node: r.id });
    await app.commands.run('slice.fromSelection');
    expect(slicesOf(doc)[1]).toMatchObject({ kind: 'user', x: 20, y: 20, w: 30, h: 30 });
    setSliceSelection(ed, [slicesOf(doc)[1].id]);
    await app.commands.run('slice.duplicate');
    expect(slicesOf(doc).length).toBe(3);
    setSliceSelection(ed, slicesOf(doc).slice(1).map((s) => s.id));
    await app.commands.run('slice.combine');
    expect(slicesOf(doc).length).toBe(2);
    // Release removes the selected object's slice.
    setSliceSelection(ed, []);
    ed.select([r.id]);
    await app.commands.run('slice.release');
    expect(slicesOf(doc).every((s) => s.kind === 'user')).toBe(true);
    expect(app.commands.isChecked('slice.clipToArtboard')).toBe(true);
    await app.commands.run('slice.clipToArtboard');
    expect(doc.root.sliceClip).toBe(false);
    await app.commands.run('slice.deleteAll');
    expect(slicesOf(doc)).toEqual([]);
  });

  it('edits slice options in a dialog', async () => {
    const { app, ed, doc } = await setup();
    doc.transact('s', () => addSlice(doc, { kind: 'user', x: 0, y: 0, w: 50, h: 50 }));
    setSliceSelection(ed, [slicesOf(doc)[0].id]);
    const done = app.commands.run('slice.options');
    await new Promise((r) => setTimeout(r, 0));
    const dialog = document.querySelector('dialog[open]');
    expect(dialog.querySelector('#so-name').value).toBe(defaultSliceName(doc, 1));
    dialog.querySelector('#so-name').value = 'Hero';
    dialog.querySelector('#so-url').value = 'https://example.com';
    dialog.querySelector('#so-bg').value = '#000000';
    [...dialog.querySelectorAll('.btn')].find((b) => b.textContent === 'OK').click();
    await done;
    expect(slicesOf(doc)[0]).toMatchObject({ name: 'Hero', url: 'https://example.com', bg: '#000000' });
  });

  it('opens Save for Web and keeps settings with Done', async () => {
    const { app, ed, doc } = await setup();
    HTMLCanvasElement.prototype.toBlob = function toBlob(cb, type) {
      cb(new Blob(['x'.repeat(10)], { type }));
    };
    doc.transact('s', () => addSlice(doc, { kind: 'user', x: 0, y: 0, w: 50, h: 50 }));
    setSliceSelection(ed, [slicesOf(doc)[0].id]);
    const done = app.commands.run('file.saveForWeb');
    for (let i = 0; i < 20 && !document.querySelector('dialog.sfw-dialog'); i++) await new Promise((r) => setTimeout(r, 10));
    const dialog = document.querySelector('dialog.sfw-dialog');
    expect(dialog).toBeTruthy();
    const format = [...dialog.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'gif'));
    format.value = 'jpeg';
    format.dispatchEvent(new Event('change'));
    [...dialog.querySelectorAll('.btn')].find((b) => b.textContent === 'Done').click();
    await done;
    expect(slicesOf(doc)[0].export.format).toBe('jpeg');
    expect(app.prefs.get('saveForWeb').percent).toBe(100);
  });
});
