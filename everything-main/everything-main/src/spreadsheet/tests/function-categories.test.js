import { expect, it } from 'vitest';
import { FUNCTION_NAMES } from '../src/core/formula/functions.js';
import { functionCategories, PRIMARY_CATEGORIES, MORE_CATEGORIES } from '../src/core/formula/categories.js';

it('places every implemented function in exactly one Function Library category', () => {
  const categories = functionCategories();
  expect([...categories.keys()].sort()).toEqual([...PRIMARY_CATEGORIES, ...MORE_CATEGORIES].sort());
  const placed = [...categories.values()].flat();
  expect(placed.length).toBe(FUNCTION_NAMES.length);
  expect(new Set(placed).size).toBe(FUNCTION_NAMES.length);
  expect(new Set(placed)).toEqual(new Set(FUNCTION_NAMES));
});

it('groups familiar functions under their usual categories, alphabetically', () => {
  const categories = functionCategories();
  expect(categories.get('Financial')).toContain('PMT');
  expect(categories.get('Logical')).toContain('IFS');
  expect(categories.get('Text')).toContain('TEXTJOIN');
  expect(categories.get('Date & Time')).toContain('EOMONTH');
  expect(categories.get('Lookup & Reference')).toEqual(expect.arrayContaining(['XLOOKUP', 'VLOOKUP', 'INDEX']));
  expect(categories.get('Math & Trig')).toEqual(expect.arrayContaining(['SUM', 'SUMIFS', 'ROUND']));
  expect(categories.get('Statistical')).toContain('AVERAGE');
  expect(categories.get('Compatibility')).toContain('STDEV');
  for (const list of categories.values()) expect(list).toEqual([...list].sort());
});

it('puts functions it does not know into Additional instead of dropping them', () => {
  const categories = functionCategories(['SUM', 'MADEUP']);
  expect(categories.get('Math & Trig')).toEqual(['SUM']);
  expect(categories.get('Additional')).toEqual(['MADEUP']);
});
