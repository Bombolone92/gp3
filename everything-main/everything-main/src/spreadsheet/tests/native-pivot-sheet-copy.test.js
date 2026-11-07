import { expect, it } from 'vitest';
import { rebasePivotWorkbookTarget } from '../src/core/native-pivot-sheet-copy.js';
import { relativeWorkbookTarget } from '../src/ui/copysheet.js';
it.each([
  ['Spreadsheets/Original #1.xlsx', 'Spreadsheets/Copy.xlsx', 'Original%20%231.xlsx'],
  ['/user/Input/原稿.xlsx', '/user/Output/Copy.xlsx', '../Input/%E5%8E%9F%E7%A8%BF.xlsx'],
  ['a/b/source.xlsx', 'a/c/d/target.xlsx', '../../b/source.xlsx'],
  ['a/../Data/source.xlsx', 'Data/target.xlsx', 'source.xlsx'],
  ['/user/Source.xlsx', 'Spreadsheets/Target.xlsx', null],
  [null, 'Spreadsheets/Target.xlsx', null],
  ['https://example.com/source.xlsx', 'Spreadsheets/Target.xlsx', null],
])('creates a relative workbook URI for %s from %s', (source, destination, expected) => {
  expect(relativeWorkbookTarget(source, destination)).toBe(expected);
});
it.each([
  ['../Data.xlsx', '../Source/Original.xlsx', '../Data.xlsx'],
  ['../../Data.xlsx', '../../Source/Original.xlsx', '../../../Data.xlsx'],
  ['Data.xlsx?version=2#book', '../Source/Original.xlsx', '../Source/Data.xlsx?version=2#book'],
  ['../Data.xlsx', '/a/b/Original.xlsx', '/a/Data.xlsx'],
  ['../../../../Data.xlsx', '/a/Original.xlsx', '/Data.xlsx'],
  ['Data.xlsx', '//server/share/Original.xlsx', '//server/share/Data.xlsx'],
  ['../Data.xlsx', 'https://example.com/source/Original.xlsx', 'https://example.com/Data.xlsx'],
  ['file:///Data.xlsx', '../Source/Original.xlsx', 'file:///Data.xlsx'],
  ['../Data.xlsx', null, '../Data.xlsx'],
  ['#range', '../Source.xlsx?version=2', '../Source.xlsx?version=2#range'],
])('rebases the existing external target %s from %s', (target, source, expected) => {
  expect(rebasePivotWorkbookTarget(target, source)).toBe(expected);
});
