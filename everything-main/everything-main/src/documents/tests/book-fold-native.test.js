import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';

const folder = 'tests/fixtures/book-fold/';
const cases = JSON.parse(readFileSync(folder + 'cases.json', 'utf8'));
const reference = JSON.parse(readFileSync(folder + 'reference.json', 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(folder + path)).digest('hex');
const byName = name => reference.cases.find(c => c.name === name).pages;

it('binds every native geometry page to the independently authored source packages', () => {
  expect(reference.referenceVersion).toBe('16.0.20326');
  expect(reference.cases.map(c => c.name)).toEqual(cases.map(c => c.name));
  for (const source of cases) {
    const native = reference.cases.find(c => c.name === source.name);
    expect(native.sourceSha256).toBe(hash(source.name + '.docx'));
    expect(native.pdfSha256).toBe(hash(source.name + '-native.pdf'));
    expect(native.pages).toHaveLength(4);
    for (const page of native.pages) expect(page.size).toEqual([source.width / 20, source.height / 20]);
  }
});

it('binds native content, numbering, story and drawing controls to their packages', () => {
  const refs=JSON.parse(readFileSync(folder+'content-reference.json','utf8'));
  expect(refs.map(c=>c.name)).toEqual(['content','numbered','content-gutter','content-even','floating']);
  for(const c of refs){expect(c.sourceSha256).toBe(hash(c.name+'.docx'));expect(c.pdfSha256).toBe(hash(c.name+'-native.pdf'));expect(c.pages).toHaveLength(4);}
  const content=refs[0],numbered=refs[1];
  expect(content.pages.map(p=>p.rectangles.wrapped[0])).toEqual([100,118,100,118]);
  expect(numbered.pages.map(p=>p.rectangles.wrapped[0])).toEqual([118,100,118,100]);
  expect(content.pages.map(p=>p.rectangles.margin[0])).toEqual([72,72,72,72]);
  expect(refs[2].pages.map(p=>p.rectangles.margin[0])).toEqual([81,81,81,81]);
});

it('observes alternating margins and reverse precedence without halving the logical page', () => {
  expect(byName('off')).toEqual(byName('absent'));
  expect(byName('four')).toEqual(byName('forward'));
  expect(byName('both')).toEqual(byName('reverse'));
  for (let i = 0; i < 4; i++) {
    const plain = byName('absent')[i];
    for (const [name, shift] of [['forward', i % 2 ? 0 : -18], ['reverse', i % 2 ? -18 : 0]]) {
      expect(byName(name)[i].left - plain.left).toBeCloseTo(shift, 3);
      expect(byName(name)[i].right - plain.right).toBeCloseTo(shift, 3);
      expect(byName(name)[i].top).toBe(plain.top);
    }
  }
});

it('records orientation and gutter interactions separately from normal book fold', () => {
  for (let i = 0; i < 4; i++) {
    const plain = byName('absent')[i];
    expect(byName('portrait')[i].left).toBe(plain.left);
    expect(byName('gutter')[i].left).toBeCloseTo(72.948, 3);
    expect(byName('gutter')[i].right).toBeCloseTo(323.59, 3);
    expect(byName('top-gutter')[i].left).toBe(plain.left);
    expect(byName('top-gutter')[i].right).toBe(plain.right);
    expect(byName('top-gutter')[i].top - plain.top).toBeCloseTo(18.02, 2);
    expect(byName('wide')[i].left).toBeCloseTo(i % 2 ? 72.948 : 54.924, 3);
  }
});
