// Native-conformance diagnostic with exact source/PDF provenance checks.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { drawingPaintColor } from '../src/engine/docx-drawing-style.js';

const folder = process.argv[2] ? new URL(`../${process.argv[2].replace(/\/$/, '')}/`, import.meta.url) : new URL('../tests/fixtures/drawing-luminance-precision/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('reference.json', folder)));
for (const [file, field] of [['source.docx', 'sourceSha256'], ['native.pdf', 'pdfSha256']]) {
  if (createHash('sha256').update(readFileSync(new URL(file, folder))).digest('hex') !== reference[field])
    throw new Error(`Native reference hash mismatch: ${file}`);
}
const dom = new JSDOM();
let failed = 0;
for (const specimen of reference.cases) {
  const xml = `<a:${specimen.kind} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" val="${specimen.base}">${specimen.transforms.map(([name, value]) => `<a:${name} val="${value}"/>`).join('')}</a:${specimen.kind}>`;
  const node = new dom.window.DOMParser().parseFromString(xml, 'application/xml').documentElement;
  const actual = drawingPaintColor(node, name => name === 'bg1' ? 'FFFFFF' : undefined);
  if (actual !== `#${specimen.rgb}`) {
    failed++;
    console.log(`Mismatch ${specimen.id}: ${specimen.base} ${JSON.stringify(specimen.transforms)} native #${specimen.rgb}, app ${actual}`);
  }
}
dom.window.close();
console.log(`${reference.cases.length - failed}/${reference.cases.length} native colors match`);
process.exitCode = failed ? 1 : 0;
