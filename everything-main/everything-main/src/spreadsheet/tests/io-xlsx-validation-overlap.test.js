import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import { parseRange } from '../src/core/cell.js';

const rule = (ref, formula, prompt) => `<dataValidation type="custom" sqref="${ref}" showErrorMessage="1" showInputMessage="1" prompt="${prompt}"><formula1>${formula}</formula1></dataValidation>`;
const open = records => workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { tail: `<dataValidations count="${records.length}">${records.join('')}</dataValidations>` } } }), 'rules.xlsx');
const promptAt = (wb, r, c) => wb.validationAt(wb.activeSheetId, r, c)?.prompt;

it('uses the first native rule at overlaps while retaining uncovered regions of later rules', async () => {
  const first = rule('B2:D4', 'B2&gt;0', 'First'), second = rule('C3:E5', 'C3&lt;0', 'Second');
  for (const reverse of [false, true]) {
    const wb = await open(reverse ? [second, first] : [first, second]);
    expect(promptAt(wb, 2, 2)).toBe(reverse ? 'Second' : 'First');
    expect(promptAt(wb, 1, 1)).toBe('First');
    expect(promptAt(wb, 4, 4)).toBe('Second');
    expect(wb.validateValue(wb.activeSheetId, 2, 2, 7).ok).toBe(!reverse);
    expect(wb.validateValue(wb.activeSheetId, 4, 4, -7).ok).toBe(true);
    expect(wb.validateValue(wb.activeSheetId, 4, 4, 7).ok).toBe(false);
  }
});

it('retains first informational rules and discards entirely shadowed rules', async () => {
  const note = '<dataValidation sqref="D7" showInputMessage="1" prompt="Note"/>';
  const restricted = rule('D7', 'D7&gt;0', 'Restricted');
  let wb = await open([note, restricted]);
  expect(promptAt(wb, 6, 3)).toBe('Note');
  expect(wb.validateValue(wb.activeSheetId, 6, 3, 'Anything').ok).toBe(true);
  expect(wb.activeSheet.validations).toHaveLength(1);
  wb = await open([restricted, note]);
  expect(wb.validateValue(wb.activeSheetId, 6, 3, -2).ok).toBe(false);
});

it('rebases all remaining pieces and multi-area relative list sources', async () => {
  const wb = await open([rule('C3:D4', 'TRUE()', 'Hole'),
    '<dataValidation type="list" sqref="B2:E5 G2:G4"><formula1>J2:J3</formula1></dataValidation>']);
  const id=wb.activeSheetId;
  for(const [r,c,source] of [[1,1,'=J2:J3'],[4,1,'=J5:J6'],[2,1,'=J3:J4'],[2,4,'=M3:M4'],[1,6,'=O2:O3']]) {
    expect(wb.validationAt(id,r,c).source).toBe(source);
  }
  wb.setInput(id, 2, 12, 'Choice');
  expect(wb.validateValue(id,2,4,'Choice').ok).toBe(true);
  expect(wb.validateValue(id,2,4,'Other').ok).toBe(false);
});

it('preserves precedence through later app edits, sheet copies and native-only export', async () => {
  let wb = await open([rule('B2:D4','B2&gt;0','First'),rule('C3:E5','C3&lt;0','Second')]);
  let id=wb.activeSheetId;
  wb.addValidation(id,{range:parseRange('C3'),type:'number',min:20,prompt:'New'});
  expect(promptAt(wb,2,2)).toBe('New'); wb.undo();
  expect(promptAt(wb,2,2)).toBe('First');
  const copy=wb.duplicateSheet(id);
  expect(wb.validationAt(copy.id,2,2).prompt).toBe('First'); wb.undo();
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx');id=wb.activeSheetId;
  expect(promptAt(wb,2,2)).toBe('First');
  expect(wb.validateValue(id,2,2,5).ok).toBe(true);
  expect(wb.validateValue(id,4,4,-5).ok).toBe(true);
});

it('keeps whole-sheet overlap sparse and ignores malformed rules before valid ones', async () => {
  const wb=await open([rule('invalid','TRUE()','Invalid'),rule('C4','C4&gt;0','First'),rule('A1:XFD1048576','A1&lt;0','Whole')]);
  expect(wb.activeSheet.validations).toHaveLength(5);
  expect(wb.activeSheet.cells.size).toBe(0);
  expect(promptAt(wb,3,2)).toBe('First');
  expect(wb.validateValue(wb.activeSheetId,1048575,16383,-4).ok).toBe(true);
});

it('keeps thousands of duplicate whole-sheet rules compact', async () => {
  const records=Array.from({length:4000},(_,i)=>rule('A1:XFD1048576','A1&gt;0',`Rule ${i}`));
  const wb=await open(records);
  expect(wb.activeSheet.validations).toHaveLength(1);
  expect(promptAt(wb,1048575,16383)).toBe('Rule 0');
  expect(wb.activeSheet.cells.size).toBe(0);
});

it('keeps native priority when the spatial sweep visits a later rule first', async () => {
  const wb=await open([rule('C3:D4','C3&gt;0','First'),rule('B1:G10','B1=5','Last')]);
  expect(promptAt(wb,2,3)).toBe('First');
  expect(promptAt(wb,9,6)).toBe('Last');
  expect(wb.validateValue(wb.activeSheetId,9,6,5).ok).toBe(true);
});
