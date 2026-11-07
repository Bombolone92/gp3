import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
const make = () => new Workbook({ sheets: [{ id:'s', cells:{'0,3':{v:'Keep'}}, sparklineGroups:[
  {type:'line',dateAxis:true,dateFormula:'A10:C10',minAxisType:'group',colorSeries:{theme:5,tint:.2},sparklines:[{ref:'D1',formula:'A1:C1'},{ref:'D2',formula:'A2:C2'},{ref:'D3',formula:'A3:C3'}]},
  {type:'column',high:true,sparklines:[{ref:'F1',formula:'A1:C1'},{ref:'F2',formula:'A2:C2'}]},
] }] });
const groups = wb => wb.sheet('s').sparklineGroups;
it('ungroups selected members and permits independent settings without changing their bindings', () => {
  const wb=make(),before=wb.toJSON(),uid=groups(wb)[0].uid;
  expect(wb.regroupNativeSparklines('s',[parseRange('D1')],{ungroup:true})).toBeNull();
  expect(groups(wb).find(g=>g.uid===uid).sparklines.map(s=>s.ref)).toEqual(['D2','D3']);
  const own=groups(wb).find(g=>g.sparklines[0].ref==='D1');expect(own).toMatchObject({dateAxis:true,dateFormula:'A10:C10',minAxisType:'group',colorSeries:{theme:5,tint:.2},sparklines:[{ref:'D1',formula:'A1:C1'}]});expect(own.uid).not.toBe(uid);
  const after=wb.toJSON();wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(wb.toJSON()).toEqual(after);
  wb.updateNativeSparkline('s','D1',{settings:{type:'stacked'}});expect(groups(wb).find(g=>g.uid===uid).type).toBe('line');
});
it('groups selected charts using the chosen member settings while retaining unselected siblings', () => {
  const wb=make(),before=wb.toJSON();
  expect(wb.regroupNativeSparklines('s',[parseRange('D1'),parseRange('F1')],{templateRef:'F1'})).toBeNull();
  expect(groups(wb).map(g=>g.sparklines.map(s=>s.ref))).toEqual([['D2','D3'],['F2'],['F1','D1']]);
  expect(groups(wb)[2]).toMatchObject({type:'column',high:true,dateAxis:false,sparklines:[{ref:'F1',formula:'A1:C1'},{ref:'D1',formula:'A1:C1'}]});
  expect(wb.getValue('s',0,3)).toBe('Keep');const after=wb.toJSON();wb.undo();expect(wb.toJSON()).toEqual(before);wb.redo();expect(wb.toJSON()).toEqual(after);
});
it('splits a selected subset into a shared group and ungroups a whole group into unique singletons', () => {
  const wb=make();wb.regroupNativeSparklines('s',[parseRange('D1:D2')],{templateRef:'D1'});
  expect(groups(wb).map(g=>g.sparklines.length)).toEqual([1,2,2]);
  wb.regroupNativeSparklines('s',[parseRange('D1:F3')],{ungroup:true});
  expect(groups(wb)).toHaveLength(5);expect(groups(wb).every(g=>g.sparklines.length===1)).toBe(true);expect(new Set(groups(wb).map(g=>g.uid)).size).toBe(5);
});
it('refuses a protected selected member atomically but does not edit protected unselected siblings', () => {
  const wb=make();wb.protectRange('s',parseRange('D2'));const before=wb.toJSON();
  expect(wb.regroupNativeSparklines('s',[parseRange('D1:D2')],{ungroup:true})).toMatch(/protected/);expect(wb.toJSON()).toEqual(before);
  expect(wb.regroupNativeSparklines('s',[parseRange('D1:D2')],{templateRef:'D1'})).toMatch(/protected/);expect(wb.toJSON()).toEqual(before);
  expect(wb.regroupNativeSparklines('s',[parseRange('D1')],{ungroup:true})).toBeNull();
});
it('rejects an unselected template and respects skipped rows across disjoint selections', () => {
  const wb=make(),before=wb.toJSON();
  expect(wb.regroupNativeSparklines('s',[parseRange('D1:D2')],{templateRef:'F1'})).toMatch(/active sparkline/);expect(wb.toJSON()).toEqual(before);
  wb.regroupNativeSparklines('s',[parseRange('D1:D3'),parseRange('F2')],{ungroup:true,skipRow:r=>r===1});
  expect(groups(wb).find(g=>g.sparklines.some(s=>s.ref==='F2')).sparklines).toHaveLength(2);
  expect(groups(wb).filter(g=>g.sparklines.length===1)).toHaveLength(3);
});
it('avoids history when grouping an existing full group or ungrouping singletons', () => {
  const wb=make(),before=wb.toJSON();wb.regroupNativeSparklines('s',[parseRange('D1:D3')],{templateRef:'D1'});expect(wb.toJSON()).toEqual(before);expect(wb.canUndo()).toBe(false);
  wb.regroupNativeSparklines('s',[parseRange('D1:D3')],{ungroup:true});wb.clearHistory();const single=wb.toJSON();wb.regroupNativeSparklines('s',[parseRange('D1:D3')],{ungroup:true});expect(wb.toJSON()).toEqual(single);expect(wb.canUndo()).toBe(false);
});
it('refuses incompatible shared date categories without changing group membership', () => {
  const wb=make();groups(wb)[1].sparklines[0].formula='A1:B1';const before=wb.toJSON();
  expect(wb.regroupNativeSparklines('s',[parseRange('D1'),parseRange('F1')],{templateRef:'D1'})).toMatch(/date range/);expect(wb.toJSON()).toEqual(before);
  expect(wb.regroupNativeSparklines('s',[parseRange('D1'),parseRange('F1')],{templateRef:'F1'})).toBeNull();
});

it.each([false, true])('resolves shared named date lengths at each selected anchor (matching: %s)', matching => {
  const wb = new Workbook({ names: [{ name: 'Dates', ref: 'OFFSET(Data!$A$4,0,0,1,ROW()+2)' }], sheets: [{ id: 's', name: 'Data', sparklineGroups: [
    { dateAxis: true, dateFormula: 'Dates', sparklines: [{ ref: 'E1', formula: 'A1:C1' }] },
    { sparklines: [{ ref: 'E2', formula: matching ? 'A2:D2' : 'A2:C2' }] },
  ] }] });
  const before = wb.toJSON();
  const error = wb.regroupNativeSparklines('s', [parseRange('E1:E2')], { templateRef: 'E1' });
  if (matching) { expect(error).toBeNull(); expect(groups(wb)).toHaveLength(1); }
  else { expect(error).toMatch(/date range/); expect(wb.toJSON()).toEqual(before); }
});
