import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root = 'tests/fixtures/theme-permutations/';
const cases = JSON.parse(readFileSync(root + 'cases.json'));
const reference = JSON.parse(readFileSync(root + 'reference.json'));

it('binds native permutation observations to the exact source and PDF', () => {
  for (const [name, key] of [['control.docx', 'sourceSha256'], ['cases.json', 'casesSha256'], ['native.pdf', 'pdfSha256']]) {
    expect(createHash('sha256').update(readFileSync(root + name)).digest('hex'), name).toBe(reference[key]);
  }
  expect(reference.pages).toBe(4);
  expect(cases).toHaveLength(128);
  expect(reference.colors.map(c => c.label)).toEqual(cases.map(c => c.label));
});

it('records channel-permutation invariance across all selected native shades and tints', () => {
  const bases = ['4F81BD', '4FBD81', '814FBD', '81BD4F', 'BD4F81', 'BD814F'];
  for (const mode of ['shade', 'tint']) for (const value of [0, 1, 64, 128, 153, 191, 254, 255]) {
    const ordered = bases.map(base => {
      const index = cases.findIndex(c => c.base === base && c.mode === mode && c.value === value);
      expect(index).toBeGreaterThanOrEqual(0);
      const input = [...Buffer.from(base, 'hex')];
      return [79, 129, 189].map(channel => reference.colors[index].rgb[input.indexOf(channel)]);
    });
    for (const rgb of ordered) expect(rgb, `${mode} ${value}`).toEqual(ordered[0]);
  }
});
