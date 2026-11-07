import { expect, it } from 'vitest';
import { createDataModelEvaluation } from '../src/core/data-model-evaluate.js';
import { fixture } from './helpers/stored-model-workbook.js';
it('shares decoded columns and a work budget across isolated measure contexts', () => {
  const session = createDataModelEvaluation(fixture(), { source: 'stored', maxValues: 13 });
  expect(session.storedRowCount('Orders')).toBe(3);
  const column = session.storedColumn('Orders', 'Net');
  expect(session.storedColumn('Orders', 'Net')).toBe(column);
  expect(session.evaluate('Orders', 'Total', { selectRows: () => [0, 2] })).toBe(18014398509481987n);
  expect(session.evaluate('Orders', 'Half', { selectRows: () => [0, 2] })).toBe(Number(18014398509481987n) / 2);
  expect(session.evaluate('Orders', 'Total', { selectRows: () => [1] })).toBeNull();
  expect(() => session.evaluate('Orders', 'Total')).toThrow(/limit/);
});
it.each([[2, 0], [0, 0], [3], [-1], [1.5], 'all'])('rejects invalid physical row selections %j', selection => {
  const session = createDataModelEvaluation(fixture(), { source: 'stored' });
  expect(() => session.evaluate('Orders', 'Total', { selectRows: () => selection })).toThrow(/row selection/);
});
it('combines explicit row subsets and predicates without leaking context to the next call', () => {
  const session = createDataModelEvaluation(fixture({ expression: 'COUNTROWS(Orders)' }), { source: 'stored' });
  expect(session.evaluate('Orders', 'Total', { selectRows: () => [0, 1], acceptRow: (_t, get) => get('Group') === 'A ' })).toBe(1);
  expect(session.evaluate('Orders', 'Total', { selectRows: () => [] })).toBeNull();
  expect(session.evaluate('Orders', 'Total')).toBe(3);
});
it('does not interpret worksheet positions as physical model ordinals', () => {
  const session = createDataModelEvaluation(fixture());
  expect(() => session.evaluate('Orders', 'Total', { selectRows: () => [0] })).toThrow(/options/);
  expect(() => session.storedRowCount('Orders')).toThrow(/Stored model source/);
});
