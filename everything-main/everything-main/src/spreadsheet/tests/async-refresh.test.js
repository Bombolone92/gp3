import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each(['refresh', 'provider change'].flatMap((reset) => ['resolve', 'reject'].map((outcome) => [reset, outcome])))(
  'keeps the newest answer after %s when an older request later settles by %s', async (reset, outcome) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const old = deferred(), fresh = deferred();
    const provider = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    wb.setAsyncProvider('AI', provider);
    wb.setInput(id, 0, 0, '=AI("answer")');
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
    await tick();
    if (reset === 'refresh') wb.clearAsyncCache();
    else wb.setAsyncProvider('AI', provider);
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
    await tick();
    fresh.resolve('New answer');
    await tick();
    expect(wb.getValue(id, 0, 0)).toBe('New answer');
    const changed = vi.fn();
    wb.addEventListener('change', changed);
    old[outcome](outcome === 'resolve' ? 'Old answer' : new Error('Old failure'));
    await tick();
    expect(wb.getValue(id, 0, 0)).toBe('New answer');
    expect(changed).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(2);
  },
);

it('keeps a refreshed import pending when an older result arrives first, without reviving its spill', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const old = deferred(), fresh = deferred();
  const provider = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  wb.setAsyncProvider('IMPORTDATA', provider);
  wb.setInput(id, 0, 0, '=IMPORTDATA("https://example.com/data.csv")');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await tick();
  wb.clearAsyncCache();
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await tick();
  old.resolve([[1], [2]]);
  await tick();
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  expect(wb.getValue(id, 1, 0)).toBeNull();
  fresh.resolve([[9]]);
  await tick();
  expect(wb.getValue(id, 0, 0)).toBe(9);
  expect(wb.getValue(id, 1, 0)).toBeNull();
  expect(provider).toHaveBeenCalledTimes(2);
});

it('does not repopulate a cleared cache before a new calculation requests the value', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const old = deferred();
  const provider = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue('Fresh');
  wb.setAsyncProvider('AI', provider);
  wb.setInput(id, 0, 0, '=AI("answer")');
  wb.getValue(id, 0, 0);
  await tick();
  wb.clearAsyncCache();
  old.resolve('Stale');
  await tick();
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
  await tick();
  expect(wb.getValue(id, 0, 0)).toBe('Fresh');
  expect(provider).toHaveBeenCalledTimes(2);
});
