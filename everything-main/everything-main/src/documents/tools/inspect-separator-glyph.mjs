// Diagnostic only. Reads local font files; records hashes/metrics, never outlines
// or font bytes. The reference file is extracted privately from the native reference PDF.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { parse } from '../src/vendor/opentype/opentype.mjs';

const [installedPath, referencePath, pdfPath, outputPath, url = 'http://127.0.0.1:5173/playground.html'] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node tools/inspect-separator-glyph.mjs installed.ttf native-subset.ttf native.pdf output.json [playground-url]');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function inspect(path) {
  const bytes = readFileSync(path), font = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const glyph = font.charToGlyph('\u2028');
  if (!glyph.index) throw new Error('Font has no U+2028 mapping: ' + path);
  return { fontSha256: hash(bytes), unitsPerEm: font.unitsPerEm, glyphIndex: glyph.index,
    advance: glyph.advanceWidth, outlineSha256: hash(JSON.stringify(glyph.path.commands)),
    commandCount: glyph.path.commands.length, bounds: glyph.getBoundingBox() };
}
const installed = inspect(installedPath), native = inspect(referencePath);
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ permissions: ['local-fonts'] });
  await page.goto(url);
  const canvas = await page.evaluate(async () => {
    const { prepareCanvasFont, fontAvailable } = await import('/src/engine/font-availability.js');
    const { localFamilyFontData } = await import('/src/engine/local-fonts.js');
    const { parse } = await import('/src/vendor/opentype/opentype.mjs');
    await prepareCanvasFont('Times New Roman');
    const face = (await localFamilyFontData('Times New Roman')).find(f => f.metadata.weight === 400 && !f.metadata.italic);
    if (!face) throw new Error('Regular Times New Roman is not available through the granted local-font catalogue.');
    const digest = await crypto.subtle.digest('SHA-256', face.buffer);
    const fontSha256 = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
    const font = parse(face.buffer), glyph = font.charToGlyph('\u2028');
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
    const context = canvas.getContext('2d'), rows = [];
    const inkPixels = () => {
      const data = context.getImageData(0, 0, 400, 200).data;
      let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
      return count;
    };
    for (const size of [12, 96]) {
      context.font = `${size}px "Times New Roman"`; context.fontKerning = 'none';
      for (const text of ['\u2028', ' ']) {
        context.clearRect(0, 0, 400, 200); context.fillText(text, 20, 120);
        const metrics = context.measureText(text);
        rows.push({ size, codepoint: text.codePointAt(0), width: metrics.width,
          ascent: metrics.fontBoundingBoxAscent, descent: metrics.fontBoundingBoxDescent, inkPixels: inkPixels() });
      }
      context.clearRect(0, 0, 400, 200); glyph.getPath(20, 120, size).draw(context);
      rows.push({ size, mode: 'selected-font-glyph-outline', advance: glyph.advanceWidth / font.unitsPerEm * size, inkPixels: inkPixels() });
    }
    return { available: fontAvailable('Times New Roman'), fullName: face.fullName, fontSha256, rows };
  });
  if (canvas.fontSha256 !== installed.fontSha256) throw new Error('Browser and inspected installed font differ.');
  const result = { pdfSha256: hash(readFileSync(pdfPath)), browserVersion: browser.version(),
    codepoint: 'U+2028', installed, native,
    identicalOutlines: installed.outlineSha256 === native.outlineSha256, canvas };
  writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ identicalOutlines: result.identicalOutlines, browserVersion: result.browserVersion, rows: canvas.rows }));
} finally { await browser.close(); }
