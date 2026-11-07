import { expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

// An .xlsx has one spelling for a row out of sight, hidden="1", so the rows a filter hides look
// exactly like the rows a collapsed outline group hides. Taking both for a collapse drew a "+"
// beside a group that is not collapsed: expanding it showed nothing (the filter still hid the
// rows), and clearing the filter then showed rows inside a group the gutter still drew closed.

const cell = (r, v) => `<c r="A${r}"><v>${v}</v></c>`;
const rows = (hidden) => [
  '<row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c></row>',
  `<row r="2">${cell(2, 10)}</row>`,
  `<row r="3" outlineLevel="1"${hidden ? ' hidden="1"' : ''}>${cell(3, 20)}</row>`,
  `<row r="4" outlineLevel="1"${hidden ? ' hidden="1"' : ''}>${cell(4, 30)}</row>`,
  `<row r="5">${cell(5, 10)}</row>`,
].join('');
const open = (rowXml, tail) => workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { rows: rowXml, tail } } }), 'outline.xlsx');
const filter = '<autoFilter ref="A1:A5"><filterColumn colId="0"><filters><filter val="10"/></filters></filterColumn></autoFilter>';

it('reads a group whose rows only the file\'s filter hides as an open group', async () => {
  const wb = await open(rows(true), filter);
  const sheet = wb.activeSheet;
  expect([...sheet.filterHidden].sort((a, b) => a - b)).toEqual([2, 3]);
  expect([...sheet.hiddenRows]).toEqual([]);
  expect(sheet.groups).toEqual({ rows: [{ from: 2, to: 3, collapsed: false }], cols: [] });
  // Clearing the filter shows the rows, and the group was open all along.
  wb.clearFilter(wb.activeSheetId);
  expect(wb.isRowHidden(wb.activeSheetId, 2)).toBe(false);
  expect(wb.sheet(wb.activeSheetId).groups.rows[0].collapsed).toBe(false);
});

it('still reads a group whose rows are hidden with no filter over them as collapsed', async () => {
  const wb = await open(rows(true), '');
  expect(wb.activeSheet.groups).toEqual({ rows: [{ from: 2, to: 3, collapsed: true }], cols: [] });
  expect([...wb.activeSheet.hiddenRows].sort((a, b) => a - b)).toEqual([2, 3]);
});

it('reads a group the filter leaves alone as an open group', async () => {
  const wb = await open(rows(false), filter);
  expect(wb.activeSheet.groups).toEqual({ rows: [{ from: 2, to: 3, collapsed: false }], cols: [] });
});
