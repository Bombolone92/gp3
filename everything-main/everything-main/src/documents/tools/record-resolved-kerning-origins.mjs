import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { reviewedFamilyOrigins } from '../tests/browser/helpers/reviewed-family-origins.js';

const output = process.argv[2];
if (!output) throw new Error('Usage: node tools/record-resolved-kerning-origins.mjs <output.json>');
const folder = 'tests/fixtures/gpos-only-kerning/';
const referenceBytes = readFileSync(folder + 'reference.json');
const reference = JSON.parse(referenceBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/playground.html');
  await page.getByRole('textbox', { name: 'Document text' }).waitFor();
  const cases = [];
  for (const sample of reference.cases) {
    for (const [name, expected] of Object.entries(sample.sha256)) {
      if (hash(readFileSync(folder + name)) !== expected) throw new Error(`Native binding changed: ${name}`);
    }
    const source = readFileSync(folder + sample.file.replace('.pdf', '.docx'));
    const actual = await reviewedFamilyOrigins(page, source.toString('base64'), true);
    if (actual.pages.length !== 1 || actual.pages[0].length !== sample.lines.length) throw new Error(`Page/line mismatch: ${sample.file}`);
    const lines = actual.pages[0].map((line, i) => {
      const native = sample.lines[i];
      if (line.text !== native.text || line.glyphs.length !== native.glyphs.length) throw new Error(`Text/glyph mismatch: ${sample.file}/${i}`);
      const deltas = line.glyphs.map((x, j) => x - native.glyphs[j]);
      return { text: line.text, glyphOriginDeltasPt: deltas,
        maxGlyphOriginErrorPt: Math.max(...deltas.map(Math.abs)),
        baselineErrorPt: Math.abs(line.baseline - native.baseline),
        maxCanvasSvgAdvanceErrorPx: Math.max(...line.advanceErrors) };
    });
    cases.push({ file: sample.file, sha256: sample.sha256, lines });
  }
  const report = { scope: 'Actual CanvasEditor structured editable layout; LTR ASCII glyph-origin proxy, not pixel equivalence.',
    nativeWordVersion: reference.referenceVersion, nativeReferenceSha256: hash(referenceBytes),
    helperCanonicalSha256: hash(readFileSync('tests/browser/helpers/reviewed-family-origins.js', 'utf8').replaceAll('\r\n', '\n')),
    adapterCanonicalSha256: hash(readFileSync('tools/reviewed-family-modules.js', 'utf8').replaceAll('\r\n', '\n')), cases };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ cases: cases.length, lines: cases.flatMap(c => c.lines).length,
    maxGlyphOriginErrorPt: Math.max(...cases.flatMap(c => c.lines.map(l => l.maxGlyphOriginErrorPt))), output }));
} finally { await browser.close(); }
