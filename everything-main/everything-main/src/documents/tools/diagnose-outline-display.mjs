// Baseline display diagnostic; this does not assert native reference equivalence.
// Run with a private output directory and the existing local Vite server.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const output = process.argv[2];
if (!output) throw Error('Usage: node tools/diagnose-outline-display.mjs <output-directory>');
mkdirSync(output, { recursive: true });
const names = ['legacy', 'modern', 'rounding', 'phase', 'group-phase', 'group-widths'];
const inputs = Object.fromEntries(names.map(name => [name, [...readFileSync(new URL(`../tests/fixtures/outline-display-width/${name}.docx`, import.meta.url))]]));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/playground.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const results = await page.evaluate(async inputs => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const output = [];
    for (const [name, bytes] of Object.entries(inputs)) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [];
      const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
      try {
        for (const zoom of [.5, 1, 2]) {
          editor.setZoom(zoom);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          output.push({ name, zoom, readOnly: !!pkg.readOnly, issues: pkg.previewIssues || [], errors: [...errors],
            pages: editor.canvases.length, pictures: editor.model.paragraphs.flatMap(p => p.runs).filter(r => r.image).length,
            width: editor.canvases[0].width, height: editor.canvases[0].height, png: editor.canvases[0].toDataURL() });
        }
      } finally { editor.destroy(); host.remove(); }
    }
    return output;
  }, inputs);
  for (const result of results) {
    writeFileSync(join(output, `outline-app-${result.name}-${result.zoom * 100}.png`), Buffer.from(result.png.split(',')[1], 'base64'));
    delete result.png;
    if (result.readOnly || result.errors.length || result.pages !== 1) throw Error(JSON.stringify(result));
  }
  writeFileSync(join(output, 'browser-imports.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ captures: results.length, allEditable: true, allOnePage: true, output: resolve(output) }));
} finally { await browser.close(); }
