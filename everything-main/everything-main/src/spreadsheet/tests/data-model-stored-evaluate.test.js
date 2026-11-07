import { expect, it } from 'vitest';
import { fixture } from './helpers/stored-model-workbook.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
const evaluate = (wb, options = {}, measure = 'Total') => wb.evaluateModelMeasure('Orders', measure, { source: 'stored', ...options });
it('evaluates saved integer columns exactly without a worksheet connection or caption guess', async () => {
  const wb = fixture(), before = wb.toJSON();
  expect(await evaluate(wb)).toBe(18014398509481987n);
  expect(await wb.evaluateModelMeasure('order caption', 'total', { source: 'stored' })).toBe(18014398509481987n);
  expect(wb.toJSON()).toEqual(before);
  await expect(wb.evaluateModelMeasure('Orders', 'Total')).rejects.toThrow(/source binding/);
});
it('filters in stored row order while preserving processed blanks and text', async () => {
  const wb = fixture();
  expect(await evaluate(wb, { acceptRow: (_t, get) => get('Group') === 'A ' })).toBe(18014398509481987n);
  expect(await evaluate(wb, { acceptRow: (_t, get) => get('Group') === 'A' })).toBeNull();
  expect(await evaluate(wb, { acceptRow: (_t, get) => get('Net') === null })).toBeNull();
  expect(await evaluate(fixture({ expression: 'COUNT(Orders[Net])' }))).toBe(2);
});
it('counts native rows independently of the worksheet and supports nested measures', async () => {
  expect(await evaluate(fixture({ expression: 'COUNTROWS(Orders)' }))).toBe(3);
  expect(await evaluate(fixture({ expression: 'COUNTROWS(Orders)' }), { acceptRow: (_t, get) => get('Group') === 'B' })).toBe(1);
  expect(await evaluate(fixture(), {}, 'Half')).toBe(Number(18014398509481987n) / 2);
  await expect(evaluate(fixture({ expression: '[Half]' }))).rejects.toThrow(/Circular/);
});
it('uses a shared work limit for decoded columns, row scans and filter getters', async () => {
  await expect(evaluate(fixture(), { maxValues: 2 })).rejects.toThrow(/limit/);
  await expect(evaluate(fixture(), { maxValues: 8 })).rejects.toThrow(/limit/);
  await expect(evaluate(fixture(), { maxValues: 20, acceptRow: (_t, get) => { for (let i = 0; i < 20; i++) get('Group'); return true; } })).rejects.toThrow(/limit/);
  expect(await evaluate(fixture(), { maxValues: 9 })).toBe(18014398509481987n);
});
it.each([{ dataType: 'Double' }, { dataType: 'Integer' }, { dataType: 'Currency' }])('rejects incompatible native values or unsupported semantic types %j', async options => {
  await expect(evaluate(fixture(options))).rejects.toThrow(/column type/);
});
it('requires consistent partition maps before joining column values', async () => {
  await expect(evaluate(fixture({ map: false }))).rejects.toThrow(/partition maps/);
  await expect(evaluate(fixture({ badCount: true }))).rejects.toThrow(/partition segment map/);
});
it('rejects invalid source modes and unknown identities', async () => {
  await expect(evaluate(fixture(), { source: 'typo' })).rejects.toThrow(/options/);
  await expect(evaluate(fixture(), {}, 'Missing')).rejects.toThrow(/measure/);
  await expect(evaluate(fixture({ expression: 'SUM(Orders[Missing])' }))).rejects.toThrow(/column/);
});
it('retains the native calculation through two XLSX cycles without sidecar metadata', async () => {
  let wb = fixture({ base: -3n });
  for (let i = 0; i < 2; i++) { wb = await nativeRoundTrip(wb); expect(await evaluate(wb)).toBe(1); }
});

it('returns BLANK for empty persisted tables without inventing rows', async () => {
  for (const expression of ['SUM(Orders[Net])', 'COUNT(Orders[Net])', 'COUNTROWS(Orders)']) {
    expect(await evaluate(fixture({ expression, empty: true }), { maxValues: 0 })).toBeNull();
  }
});

it('uses stored floating-point columns for decimal measures', async () => {
  expect(await evaluate(fixture({ dataType: 'Double', real: true, base: -5n }))).toBe(-1.5);
  expect(await evaluate(fixture({ dataType: 'Double', real: true, base: -5n, expression: 'AVERAGE(Orders[Net])' }))).toBe(-0.75);
});
