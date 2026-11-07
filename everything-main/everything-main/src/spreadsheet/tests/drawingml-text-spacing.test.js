import { expect, it } from 'vitest';
import { drawingText } from '../src/core/drawingml-text.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';

const node = (name, attrs = {}, children = [], text) => ({ name, attrs, children, text });
const render = (list, paragraph, values) => drawingText(node('sp', {}, [node('txBody', {}, [
  node('lstStyle', {}, [node('lvl1pPr', {}, [node('defRPr', list)])]),
  node('p', {}, [node('pPr', {}, [node('defRPr', paragraph)]), ...values.map((attrs, i) => node('r', {}, [node('rPr', attrs), node('t', {}, [], `run${i}`)]))]),
])]), [0, 0, 952500, 476250], () => null);
const spans = html => [...html.matchAll(/<span style="([^"]*)">/g)].map(m => m[1].match(/letter-spacing:([^;]+)/)[1]);

it('converts signed hundredths of a point and respects list, paragraph and run inheritance', () => {
  expect(spans(render({ spc: '150' }, {}, [{}, { spc: '-45' }, { spc: '0' }]))).toEqual(['2px', '-0.6px', '0px']);
  expect(spans(render({ spc: '150' }, { spc: '75' }, [{}, { spc: '300' }]))).toEqual(['1px', '4px']);
});

it('ignores malformed/out-of-range values without discarding valid inherited spacing', () => {
  expect(spans(render({ spc: '-75' }, {}, ['', 'bad', 'Infinity', '400001', '-400001', '1.5'].map(spc => ({ spc }))))).toEqual(Array(6).fill('-1px'));
  expect(spans(render({}, {}, [{ spc: '-400000' }, { spc: '400000' }]))).toEqual([`${-400000 / 75}px`, `${400000 / 75}px`]);
});

it('retains per-run character spacing in native XLSX without private workbook metadata', async () => {
  const wb = await workbookFromFile(shapeXlsx({ run: '<a:r><a:rPr sz="1800" spc="-90"/><a:t>Condensed</a:t></a:r><a:r><a:rPr spc="225"/><a:t> Expanded</a:t></a:r>' }));
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  const art = Buffer.from(back.activeSheet.charts[0].src.split(',')[1], 'base64').toString();
  expect(spans(art)).toEqual(['-1.2px', '3px']);
});
