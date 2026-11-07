// Actual runtime placement check, with no module replacements or font decoding.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [source, nativePath, output] = process.argv.slice(2);
assert(source && nativePath && output && !existsSync(output), 'Provide source, native reference and fresh report');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = readFileSync(source), native = JSON.parse(readFileSync(nativePath));
assert.equal(hash(bytes), native.sourceSha256);
assert(native.sourceUnchanged && native.savedStateUnchanged);
const modules = ['layout', 'pagination', 'floating-table-flow'].map(name => [name, hash(readFileSync(`src/engine/${name}.js`))]);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/playground.html');
  const actual = await page.evaluate(async bytes => {
    const { openCanvasDocument } = await import('/src/engine/open-document.js');
    const { CanvasEditor } = await import('/src/engine/canvas-editor.js');
    const { pkg, images } = await openCanvasDocument(Uint8Array.from(bytes)), host = document.createElement('div');
    document.body.append(host); const errors = [];
    const editor = new CanvasEditor(host, { ...pkg, images, onError: error => errors.push(error.message) });
    try { return { pages: editor.layout.pages.length, readOnly: editor.readOnly, errors,
      approximations: editor.layout.floatingTableApproximations || [],
      frames: editor.layout.floatingTables,
      lines: editor.layout.lines.map(l => ({ page: l.page, text: l.fragments.map(f => f.text || '').join('').replace(/\s/g, ''), x: l.fragments[0]?.x * .75, y: l.baseline * .75 })) }; }
    finally { editor.destroy(); host.remove(); }
  }, [...bytes]);
  const rows = native.lines.filter(line => /row\d+$/.test(line.text));
  const comparison = rows.map(expected => {
    const matches = actual.lines.filter(line => line.text === expected.text);
    assert.equal(matches.length, 1, expected.text);
    return { text: expected.text, nativePage: expected.page, actualPage: matches[0].page, xDeltaPt: matches[0].x - expected.x, baselineDeltaPt: matches[0].y - expected.y };
  });
  const report = { sourceSha256: hash(bytes), nativePdfSha256: native.nativePdfSha256, referenceBuild: native.referenceBuild,
    modules: Object.fromEntries(modules), browserVersion: browser.version(), scope: 'Bounded actual-runtime origins/pages; no glyph, border or full native raster certification.',
    pages: actual.pages, nativePages: native.pages, readOnly: actual.readOnly, errors: actual.errors, approximations: actual.approximations,
    rowCount: comparison.length, pageMismatches: comparison.filter(row => row.nativePage !== row.actualPage).length,
    maxXDeltaPt: Math.max(...comparison.map(row => Math.abs(row.xDeltaPt))),
    maxBaselineDeltaPt: Math.max(...comparison.map(row => Math.abs(row.baselineDeltaPt))), comparison };
  for (const [name, expected] of modules) assert.equal(hash(readFileSync(`src/engine/${name}.js`)), expected);
  assert.equal(hash(readFileSync(source)), native.sourceSha256);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ pages: report.pages, rows: report.rowCount, maxXDeltaPt: report.maxXDeltaPt, maxBaselineDeltaPt: report.maxBaselineDeltaPt }));
  assert.equal(report.readOnly, false); assert.deepEqual(report.errors, []); assert.deepEqual(report.approximations, []);
  assert.equal(report.pages, report.nativePages); assert.equal(report.pageMismatches, 0);
  assert(report.maxXDeltaPt <= .35 && report.maxBaselineDeltaPt <= .15, 'Origin limits exceeded; report preserved');
} finally { await browser.close(); }
