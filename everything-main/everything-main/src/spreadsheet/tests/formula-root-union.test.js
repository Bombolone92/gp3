import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { calc } from './helpers/calc.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

function fixture() {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: {
    '0,0': { v: 3 }, '2,0': { v: 7 }, '3,0': { v: 11 },
  } }], names: [{ name: 'Parts', ref: 'Data!$A$3:$A$4,Data!$A$1' }] });
  const id = wb.sheets[0].id;
  const chart = { ...defaultChart({r1:0,c1:0,r2:3,c2:0}, {r:0,c:3}), sourceRefs: [{ values: 'Parts' }] };
  return { wb, id, chart };
}

describe('unparenthesized reference unions', () => {
  it('shares the existing union AST and preserves area order', () => {
    expect(parseFormula('B2:B4,D7')).toEqual(parseFormula('(B2:B4,D7)'));
    expect(parseFormula('B2,(D7,F9)')).toEqual(parseFormula('(B2,(D7,F9))'));
    const { wb, id, chart } = fixture();
    wb.setInput(id, 6, 0, '=SUM(Parts)');
    wb.setInput(id, 7, 0, '=AREAS(Parts)');
    expect(wb.getValue(id, 6, 0)).toBe(21);
    expect(wb.getValue(id, 7, 0)).toBe(2);
    expect(chartData(wb,id,chart).series[0].values).toEqual([7,11,3]);
    wb.setInput(id, 2, 0, '13');
    expect(chartData(wb,id,chart).series[0].values).toEqual([13,11,3]);
    expect(wb.getValue(id, 6, 0)).toBe(27);
  });
  it('keeps function arguments and array columns distinct', () => {
    expect(parseFormula('SUM(A1,A3)').args).toHaveLength(2);
    expect(parseFormula('{1,2;3,4}').rows).toHaveLength(2);
    expect(calc('SUM((A1,A3),5)', { A1:2,A3:4 })).toBe(11);
    expect(calc('1,2')).toEqual({ error:'#VALUE!' });
    expect(() => parseFormula('A1,')).toThrow();
    expect(() => parseFormula(',A1')).toThrow();
  });
  it('keeps references live through native-only export and copied formulas', async () => {
    const { wb,id,chart } = fixture();
    wb.sheets[0].charts.push(chart);
    wb.setInput(id,6,0,'=SUM(Parts)');
    wb.pasteCells(id,wb.copyRange(id,{r1:6,c1:0,r2:6,c2:0}),6,1,{r:6,c:0});
    expect(wb.getValue(id,6,1)).toBe(21);
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const zip=X.CFB.read(bytes,{type:'array'}), part=X.CFB.find(zip,'/xl/workbook.xml');
    part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
    const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'union.xlsx'), sheet=restored.sheets[0];
    expect(restored.getValue(sheet.id,6,1)).toBe(21);
    expect(chartData(restored,sheet.id,sheet.charts[0]).series[0].values).toEqual([7,11,3]);
    restored.setInput(sheet.id,0,0,'9');
    expect(chartData(restored,sheet.id,sheet.charts[0]).series[0].values).toEqual([7,11,9]);
  });
});
