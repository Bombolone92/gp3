import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { luminanceTransform } from '../src/engine/colors.js';

const root = 'tests/fixtures/theme-domain-colors/';
const read = name => JSON.parse(readFileSync(root + name, 'utf8'));
const cases = read('cases.json'), native = read('reference.json');

it('binds paired native colors to the independent source, case order and PDF', () => {
  expect(native.capture).toEqual(read('native-capture.json'));
  expect(native.capture.sourceUnchanged).toBe(true);
  expect(native.capture.pages).toBe(2);
  for (const [name, hash] of [['control.docx', native.capture.sourceSha256],
    ['native.pdf', native.capture.pdfSha256], ['cases.json', native.casesSha256]]) {
    expect(createHash('sha256').update(readFileSync(root + name)).digest('hex')).toBe(hash);
  }
  expect(cases).toHaveLength(32);
  expect(native.rows.map(({ observed, ...row }) => row)).toEqual(cases);
  for (const base of ['4F81BD', 'C0504D', '7F8080', '202121']) {
    expect(cases.filter(c => c.base === base).map(c => c.shade)).toEqual([8, 14, 85, 86, 128, 191, 228, 255]);
  }
});

it('preserves native DrawingML color conversion independently of WML shade precision', () => {
  let differingDomains = 0;
  for (const row of native.rows) {
    const { wml, drawingRgbFloor, drawingSchemeFloor, drawingRgbCeil } = row.observed;
    expect(drawingSchemeFloor.rgb).toEqual(drawingRgbFloor.rgb);
    expect(drawingRgbCeil.rgb).toEqual(drawingRgbFloor.rgb);
    if (JSON.stringify(wml.rgb) !== JSON.stringify(drawingRgbFloor.rgb)) differingDomains++;
    for (const amount of [row.floor, row.ceil]) {
      const channels = [...Buffer.from(row.base, 'hex')].map(v => v / 255);
      expect(luminanceTransform(channels, amount / 100000).map(v => Math.round(v * 255)), row.label)
        .toEqual(drawingRgbFloor.rgb);
    }
  }
  expect(differingDomains).toBe(24);
  expect(native.summary).toEqual({ differentDomains: 24, differentDrawingSources: 0, differentPercentRounding: 0 });
  expect(native.rows[0].observed.wml.rgb).toEqual([2, 3, 6]);
  expect(native.rows[0].observed.drawingRgbFloor.rgb).toEqual([2, 4, 6]);
});

it('independently confirms all paired cell shades against prior native WML run colors', () => {
  const previous = new Map();
  for (const name of ['theme-shade-sweep', 'theme-low-chroma-sweep', 'theme-chroma-midtones']) {
    const folder = `tests/fixtures/${name}/`;
    const inputs = JSON.parse(readFileSync(folder + 'cases.json', 'utf8'));
    const reference = JSON.parse(readFileSync(folder + 'reference.json', 'utf8'));
    for (const [file, key] of [['control.docx', 'sourceSha256'], ['cases.json', 'casesSha256'], ['native.pdf', 'pdfSha256']]) {
      expect(createHash('sha256').update(readFileSync(folder + file)).digest('hex')).toBe(reference[key]);
    }
    expect(reference.colors.map(c => c.label)).toEqual(inputs.map(c => c.label));
    inputs.forEach((input, index) => previous.set(`${input.base}/${input.mode}/${input.value}`, reference.colors[index].rgb));
  }
  for (const row of native.rows) expect(previous.get(`${row.base}/shade/${row.shade}`), row.label).toEqual(row.observed.wml.rgb);
});
