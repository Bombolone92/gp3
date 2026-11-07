import {it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {textTransform} from '../src/engine/text-geometry.js';
const folder = 'tests/fixtures/bundled-script/';
const reference = JSON.parse(readFileSync(folder+'origin-reference.json'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

it('binds every native zero-gap observation to its DOCX, metafile and bundled font', () => {
  expect(hash(folder+'control.docx')).toBe(reference.sourceSha256);
  expect(hash(folder+'cases.json')).toBe(reference.casesSha256);
  expect(reference.cases).toHaveLength(3);
  for (const entry of reference.cases) {
    expect(hash(folder+entry.metafile)).toBe(entry.metafileSha256);
    expect(hash('public/fonts/'+entry.font)).toBe(entry.fontSha256);
    expect(entry.reselectedFontTables).toHaveLength(11);
    expect(entry.rows).toHaveLength(12);
    for (const row of entry.rows) {
      expect(row.scriptOriginLogical).toBe(row.prefixEndLogical);
      expect(row.horizontalGapLogical).toBe(0);
    }
    for (let i=0; i<entry.rows.length; i+=2) {
      expect(entry.rows[i].prefixAdvances).toEqual(entry.rows[i+1].prefixAdvances);
      expect(entry.rows[i].scriptOriginLogical).toBe(entry.rows[i+1].scriptOriginLogical);
    }
  }
});

it('retains native horizontal adjacency through width scaling and explicit vertical shifts', () => {
  for (const entry of reference.cases) for (const row of entry.rows) {
    for (const textScale of [50,100,200]) for (const baselineShift of [-2,0,3]) {
      const base = textTransform({fontSize:row.size, italic:entry.face==='italic', verticalAlign:row.script});
      const transformed = textTransform({fontSize:row.size, italic:entry.face==='italic', verticalAlign:row.script, textScale, baselineShift});
      expect(transformed.offsetX).toBe(row.horizontalGapLogical);
      expect(transformed.scaleX).toBeCloseTo(base.scaleX*textScale/100);
      expect(transformed.offsetY).toBeCloseTo(base.offsetY-baselineShift*4/3);
    }
  }
});
