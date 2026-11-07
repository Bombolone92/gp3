import { it, expect } from 'vitest';
import { roundColumnWidths, fixedColumnWidths, autoColumnWidths } from '../src/engine/tables.js';
for (const [total, expected] of [[7000,[1167,2333,3500]],[7001,[1166,2334,3501]],[7002,[1167,2334,3501]],[7003,[1167,2334,3502]],[7004,[1167,2335,3502]],[7005,[1167,2335,3503]]]) it(`native three-column allocation at ${total} twips`, () => {
  expect(roundColumnWidths([1,2,3].map(w => w * total / 6))).toEqual(expected);
});
it('shares positive rounding remainder across leading columns, preserving the total', () => {
  expect(roundColumnWidths(Array(5).fill(1080.2))).toEqual([1081,1080,1080,1080,1080]);
  expect(roundColumnWidths(Array(5).fill(1080.4))).toEqual([1081,1081,1080,1080,1080]);
});
it('retains integral allocations without mutating inputs', () => {
  const original = [1200,2400,3600]; expect(roundColumnWidths(original)).toEqual(original);
  const fractional = [1166.8333333333,2333.6666666667,3500.5], copy = [...fractional];
  roundColumnWidths(fractional); expect(fractional).toEqual(copy);
});
it('does not create nonpositive cells when a sub-twip grid cannot be rounded', () => {
  expect(roundColumnWidths([.1,.9])).toEqual([.1,.9]);
});

const percentageCases = [
  [[833,1667,2500],[1000,2000,3000]],
  [[833,1666,2500],[1000,1999,3001]],
  [[834,1666,2500],[1001,1999,3000]],
  [[832,1666,2500],[999,2000,3001]],
  [[830,1660,2490],[1000,2000,3000]],
  [[850,1650,2500],[1020,1980,3000]],
];
for (const layout of ['fixed','autofit']) for (const [values, expected] of percentageCases) it(`${layout} normalizes whole percentage units before twip allocation: ${values}`, () => {
  const table = {layout, grid:[1000,2000,3000],width:{type:'dxa',value:6000},rows:[{cells:values.map(value=>({width:{type:'pct',value},margins:{left:0,right:0}}))}]};
  const original = structuredClone(table);
  const widths = layout === 'fixed' ? fixedColumnWidths(table,6000) : autoColumnWidths(table,6000,values.map(()=>({min:200,max:200,floor:100,paddingFloor:20})));
  expect(roundColumnWidths(widths)).toEqual(expected);
  expect(table).toEqual(original);
});
it('balances a percentage rounding remainder larger than the number of cells', () => {
  expect(roundColumnWidths([100,100,100],311)).toEqual([104,104,103]);
  expect(roundColumnWidths([100,100,100],289)).toEqual([96,96,97]);
});

it('preserves a feasible content minimum when balancing a negative rounding remainder', () => {
  const widths = [981, 673, 673, 673];
  expect(roundColumnWidths(widths, 2999, [981, 121, 121, 121])).toEqual([981, 672, 673, 673]);
  expect(widths).toEqual([981, 673, 673, 673]);
});
it('does not force infeasible content minima into a compressed table', () => {
  expect(roundColumnWidths([500.5, 500.5], 1001, [981, 981])).toEqual([500, 501]);
});

it('retains merged minima when the leading column pays a rounding remainder', () => {
  const widths=[332.6451204055767,334.3548795944233,166.5,166.5];
  const span={column:0,span:2,min:667};
  const rounded=roundColumnWidths(widths,1000,[1,1,1,1],[span]);
  expect(rounded.reduce((a,b)=>a+b,0)).toBe(1000);
  expect(rounded.every(Number.isInteger)).toBe(true);
  expect(rounded[0]+rounded[1]).toBeGreaterThanOrEqual(667);
  expect(rounded.every(w=>w>=1)).toBe(true);
  expect(roundColumnWidths(widths,1000,[],[{...span,min:1001}])).toEqual([332,334,167,167]);
});

it('preserves crossing merged constraints while rounding a grid', () => {
  const widths=[100.4,100.6,100.5,100.5],spans=[{column:0,span:2,min:201},{column:1,span:2,min:201},{column:2,span:2,min:201}];
  const before=structuredClone({widths,spans});
  const rounded=roundColumnWidths(widths,402,[1,1,1,1],spans);
  expect(rounded.reduce((a,b)=>a+b,0)).toBe(402);
  expect(rounded.every(Number.isInteger)).toBe(true);
  for(const s of spans)expect(rounded.slice(s.column,s.column+s.span).reduce((a,b)=>a+b,0)).toBeGreaterThanOrEqual(s.min);
  expect({widths,spans}).toEqual(before);
});
