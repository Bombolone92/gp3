import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { RecordingSink } from '../src/core/display.js';
import { exportPdf, exportPdfPages } from '../src/io/export/pdf.js';

const black = { rgb: [255, 255, 255], aci7: true, lw: 25, pattern: [], id: 1, alpha: 1 };
const dashed = { rgb: [255, 0, 0], aci7: false, lw: 50, pattern: [12, -6], id: 2, alpha: 1 };
const dotted = { rgb: [0, 0, 255], aci7: false, lw: 25, pattern: [0, -3], id: 3, alpha: 1 };
const faint = { rgb: [0, 255, 0], aci7: false, lw: 25, pattern: [], id: 4, alpha: 0.5 };

const text = (bytes) => Buffer.from(bytes).toString('latin1');
const fixedDate = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
const oneToOne = {
  paper: 'A4',
  orientation: 'landscape',
  margins: 10,
  area: [0, 0, 100, 100],
  scale: { paper: 1, drawing: 1 },
  center: false,
  creationDate: fixedDate,
};

function lineItems() {
  const s = new RecordingSink();
  s.line([0, 0, 100, 0], false, black);
  return s.items;
}

/** Check the cross-reference table and trailer; returns the object count. */
function checkStructure(pdf) {
  const s = text(pdf);
  expect(s.startsWith('%PDF-1.4\n')).toBe(true);
  expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
  const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF/)[1]);
  expect(s.slice(startxref, startxref + 5)).toBe('xref\n');
  const head = s.slice(startxref).match(/^xref\n0 (\d+)\n/);
  const size = Number(head[1]);
  let pos = startxref + head[0].length;
  const first = s.slice(pos, pos + 20);
  expect(first).toBe('0000000000 65535 f\r\n');
  pos += 20;
  for (let i = 1; i < size; i++) {
    const line = s.slice(pos, pos + 20);
    expect(line).toMatch(/^\d{10} 00000 n\r\n$/);
    const off = Number(line.slice(0, 10));
    expect(s.slice(off, off + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    pos += 20;
  }
  expect(s.slice(pos).startsWith('trailer\n')).toBe(true);
  expect(s).toMatch(new RegExp(`/Size ${size} /Root 1 0 R /Info 3 0 R`));
  return size;
}

/** Raw bytes of the n-th stream in the file. */
function streamBytes(pdf, n = 0) {
  const s = text(pdf);
  let at = 0;
  let m;
  const re = /\/Length (\d+)[^>]*>>\nstream\n/g;
  for (let i = 0; i <= n; i++) m = re.exec(s);
  at = m.index + m[0].length;
  return pdf.slice(at, at + Number(m[1]));
}

describe('exportPdf', () => {
  it('writes a structurally valid PDF with exact xref offsets', async () => {
    const pdf = await exportPdf(lineItems(), { ...oneToOne, title: 'Plan (rev A)' });
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(checkStructure(pdf)).toBe(6);
    const s = text(pdf);
    expect(s).toContain('/Producer (CAD)');
    expect(s).toContain('/CreationDate (D:20260102030405Z)');
    expect(s).toContain('/Title (Plan \\(rev A\\))');
    expect(s).toContain('/Filter /FlateDecode');
  });

  it('sizes the page MediaBox in points', async () => {
    const pdf = await exportPdf(lineItems(), { paper: 'A4', orientation: 'portrait', compress: false });
    const box = text(pdf).match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    expect(Number(box[1])).toBeCloseTo(595.28, 1);
    expect(Number(box[2])).toBeCloseTo(841.89, 1);
  });

  it('writes plain path operators for a simple line when uncompressed', async () => {
    const pdf = await exportPdf(lineItems(), { ...oneToOne, compress: false });
    expect(text(pdf)).not.toContain('/FlateDecode');
    const c = text(streamBytes(pdf));
    expect(c.startsWith('q\n')).toBe(true);
    expect(c).toContain('re W n\n');
    expect(c).toContain('1 J 1 j\n');
    expect(c).toContain('0 0 0 RG\n');
    expect(c).toContain('0.709 w\n');
    // 10 mm and 110 mm in points.
    expect(c).toContain('28.346 28.346 m\n311.811 28.346 l\nS\n');
    expect(c.trimEnd().endsWith('Q')).toBe(true);
  });

  it('compresses the content stream with zlib deflate', async () => {
    const pdf = await exportPdf(lineItems(), oneToOne);
    const c = inflateSync(Buffer.from(streamBytes(pdf))).toString('latin1');
    expect(c).toContain('28.346 28.346 m\n311.811 28.346 l\nS\n');
  });

  it('uses dash arrays, round caps for dots, fills and transparency', async () => {
    const s = new RecordingSink();
    s.line([0, 10, 100, 10], false, dashed);
    s.line([0, 20, 100, 20], false, dotted);
    s.fill([[0, 30, 50, 30, 50, 60, 0, 60], [10, 40, 20, 40, 20, 50, 10, 50]], faint);
    s.line([0, 70, 100, 70], false, black);
    const pdf = await exportPdf(s.items, { ...oneToOne, compress: false, lineCap: 'butt' });
    checkStructure(pdf);
    const c = text(streamBytes(pdf));
    expect(c).toContain('1 0 0 RG\n');
    expect(c).toContain('1.417 w\n');
    expect(c).toContain('[34.016 17.008] 0 d\n');
    expect(c).toContain('[0 8.504] 0 d\n1 J\n');
    expect(c).toContain('0 1 0 rg\n/GA0 gs\n');
    expect((c.match(/ h\n|\nh\n/g) || []).length).toBe(2);
    expect(c).toContain('f*\n');
    expect(c).toContain('/GA1 gs\n');
    const doc = text(pdf);
    expect(doc).toContain('/GA0 << /Type /ExtGState /CA 0.5 /ca 0.5 >>');
    expect(doc).toContain('/GA1 << /Type /ExtGState /CA 1 /ca 1 >>');
  });

  it('writes several pages', async () => {
    const pages = [
      { items: lineItems(), settings: { paper: 'A4' } },
      { items: lineItems(), settings: { paper: 'A3', orientation: 'landscape' } },
    ];
    const pdf = await exportPdfPages(pages, { compress: false });
    expect(checkStructure(pdf)).toBe(8);
    const s = text(pdf);
    expect(s).toContain('/Kids [4 0 R 6 0 R] /Count 2');
    expect(s.match(/\/Type \/Page /g).length).toBe(2);
  });
});
