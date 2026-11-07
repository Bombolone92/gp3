// Read-only import/render diagnostic; not a glyph-equivalence oracle.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'tests/fixtures/nonbreaking-hyphen/';
const names = ['before', 'after', 'both'].flatMap(p => ['element', 'unicode'].map(k => `${p}-${k}`));
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/playground.html');
  const sources = names.map(name => {
    const bytes = readFileSync(folder + name + '.docx');
    return { name, bytes: [...bytes], sha256: createHash('sha256').update(bytes).digest('hex') };
  });
  const results = await page.evaluate(async sources => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const out = [];
    for (const { name, bytes, sha256 } of sources) {
      const { pkg, images } = await openCanvasDocument(new Uint8Array(bytes));
      const host = document.createElement('div'); document.body.append(host);
      const errors = [], editor = new CanvasEditor(host, { ...pkg, images, onError: e => errors.push(e.message) });
      try {
        const runs = [...pkg.paragraphs, ...Object.values(pkg.pageStories?.stories || {}).flatMap(s => s.paragraphs)].flatMap(p => p.runs);
        out.push({ name, sha256, readOnly: !!pkg.readOnly, issues: pkg.previewIssues || [],
          pictures: runs.filter(r => r.image).length, tables: pkg.tables.length,
          linkedPictures: runs.filter(r => r.image && r.link).length,
          boldPictureRuns: runs.filter(r => r.image && r.bold).length,
          pages: editor.canvases.length, errors });
      } finally { editor.destroy(); host.remove(); }
    }
    return out;
  }, sources);
  const controls = results.filter(r => r.name.endsWith('-unicode'));
  if (controls.some(r => r.readOnly || r.pictures !== 4 || r.linkedPictures !== 4 || r.errors.length)) {
    throw Error(`Unicode controls failed: ${JSON.stringify(controls)}`);
  }
  const retained = results.every(r => r.pictures === 4 && r.linkedPictures === 4 && !r.errors.length);
  console.log(JSON.stringify({ retained, results }, null, 2));
  if (!retained) process.exitCode = 1;
} finally { await browser.close(); }
