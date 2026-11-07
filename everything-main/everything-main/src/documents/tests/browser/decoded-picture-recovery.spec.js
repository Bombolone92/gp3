import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/decoded-picture-recovery/';

test('failed pixels retain cropped frames, nested siblings, fills and text-box content', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.goto('/playground.html', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async sources => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { paintDecodedImage } = await import('/src/engine/images.js');
    const probe = new OffscreenCanvas(100,100).getContext('2d');
    probe.beginPath(); probe.rect(0,0,10,10);
    paintDecodedImage(probe, { previewPlaceholder: true }, 30,30,48,48);
    const pathRetained = probe.isPointInPath(5,5) && !probe.isPointInPath(50,50);
    const opened = [];
    for (const source of sources) {
      const { pkg, images } = await openCanvasDocument(Uint8Array.from(atob(source), c => c.charCodeAt(0)));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [], editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      const canvas = editor.canvases[0], pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      opened.push({ pkg, images, editor, host, canvas, pixels, errors });
    }
    const [a, b] = opened;
    // Independently authored page-relative frames, in points. The first box
    // includes the 15-degree rotation; the outlined fill includes its 4pt pen
    // (2pt outside each edge); the last contains the text-box picture.
    const affected = [[50,100,110,100], [72,220,60,60], [70,318,64,64], [162,320,60,60], [72,420,240,60]];
    const scale = a.canvas.width / 612;
    let changed = 0, outside = 0;
    const markers = [0, 0, 0, 0];
    for (let i = 0; i < a.pixels.length; i += 4) {
      const x = i / 4 % a.canvas.width / scale, y = Math.floor(i / 4 / a.canvas.width) / scale;
      if ([0,1,2,3].some(k => a.pixels[i+k] !== b.pixels[i+k])) {
        changed++;
        if (!affected.some(([l,t,w,h]) => x >= l-1 && x <= l+w+1 && y >= t-1 && y <= t+h+1)) outside++;
      }
      if (b.pixels[i] === 243 && b.pixels[i+1] === 244 && b.pixels[i+2] === 246) {
        for (let row = 0; row < 4; row++) if (y >= 100 + row*100 && y < 200 + row*100) markers[row]++;
      }
    }
    // Paragraph IDs are allocated per document. Read-only mode also changes
    // the oversized-line policy flag, not these measured lines and frames.
    const geometry = e => JSON.parse(JSON.stringify({ lines: [...e.layout.lines, ...e.storyLayout.lines], floating: e.layout.floatingObjects },
      (key, value) => ['paragraphId', 'allowOversizedLines'].includes(key) ? undefined : value));
    let exportBlocked = false; try { b.pkg.export(); } catch { exportBlocked = true; }
    const result = { readOnly: [!!a.pkg.readOnly, !!b.pkg.readOnly], issues: b.pkg.previewIssues,
      outline: opened.map(o => [...o.canvas.getContext('2d').getImageData(Math.round(110*scale), Math.round(320*scale), 1, 1).data].slice(0,3)),
      errors: opened.flatMap(o => o.errors), pages: opened.map(o => o.editor.canvases.length),
      geometry: [geometry(a.editor), geometry(b.editor)],
      scenes: Object.entries(b.pkg.assets).filter(([, asset]) => asset.scene).map(([id]) => ({ id, retained: !!b.images.get(id)?.bitmap })),
      changed, outside, markers, exportBlocked, pathRetained, png: b.canvas.toDataURL() };
    for (const o of opened) { o.editor.destroy(); o.host.remove(); }
    return result;
  }, ['healthy', 'broken'].map(name => readFileSync(`${folder}${name}.docx`).toString('base64')));
  writeFileSync(info.outputPath('recovered.png'), Buffer.from(result.png.split(',')[1], 'base64'));
  const { png, ...evidence } = result;
  writeFileSync(info.outputPath('result.json'), JSON.stringify(evidence, null, 2));
  expect(result.readOnly).toEqual([false, true]); expect(result.errors).toEqual([]); expect(result.pages).toEqual([1,1]);
  expect(result.issues).toEqual(['Image word/media/image2.png: The image could not be decoded.']);
  expect(result.geometry[1]).toEqual(result.geometry[0]); expect(result.exportBlocked).toBe(true);
  expect(result.outline).toEqual([[34,68,204], [34,68,204]]);
  expect(result.pathRetained).toBe(true);
  expect(result.scenes.length).toBeGreaterThanOrEqual(3); expect(result.scenes.every(s => s.retained)).toBe(true);
  expect(result.changed).toBeGreaterThan(1000); expect(result.outside).toBe(0);
  for (const count of result.markers) expect(count).toBeGreaterThan(100);
  await openReadOnlyPreview(page, `${folder}broken.docx`);
});
