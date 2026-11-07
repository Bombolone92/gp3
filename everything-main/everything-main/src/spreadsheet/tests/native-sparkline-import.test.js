// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { placeImport } from '../src/ui/importdialog.js';
import { nativeSparklineData } from '../src/core/native-sparkline-data.js';
const source = () => new Workbook({ sheets: [{ id: 'src', name: 'Source', cells: { '1,1': { v: 4 }, '1,2': { v: 9 }, '2,1': { v: 45000 }, '2,2': { v: 45001 } }, sparklineGroups: [{ dateAxis: true, dateFormula: 'Source!B3:C3', high: true, sparklines: [{ ref: 'E2', formula: 'Source!B2:C2' }, { ref: 'A1', formula: 'B2:C2' }] }] }] });
it('imports blank anchors, local data and a shared date axis in one undo step', () => {
  const other = source(), original = other.toJSON(), wb = new Workbook(), id = wb.activeSheetId, before = wb.toJSON();
  expect(placeImport(wb, id, other, { mode: 'cell', otherSheetId: 'src', at: { r: 4, c: 2 } })).toBeTruthy();
  const group = wb.sheet(id).sparklineGroups[0];
  expect(group).toMatchObject({ high: true, dateFormula: 'D7:E7', sparklines: [{ ref: 'G6', formula: 'D6:E6' }, { ref: 'C5', formula: 'D6:E6' }] });
  expect(nativeSparklineData(wb,id,5,6).points.map(p=>p.value)).toEqual([4,9]);
  expect(other.toJSON()).toEqual(original); const after=wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('imports a chart-only sheet and replaces covered charts without touching neighbors', () => {
  const other = new Workbook({ sheets:[{ id:'src',name:'Source',sparklineGroups:[{sparklines:[{ref:'C4'}]}]}] });
  const wb=new Workbook({sheets:[{id:'dest',sparklineGroups:[{sparklines:[{ref:'E8'},{ref:'F8'}]}]}]});
  expect(wb.placeSheetAt('dest',other,'src',7,4)).toEqual({r1:7,c1:4,r2:7,c2:4});
  const groups=wb.sheet('dest').sparklineGroups;expect(groups).toHaveLength(2);expect(groups[0].sparklines).toEqual([{ref:'F8'}]);expect(groups[1].sparklines).toEqual([{ref:'E8'}]);
});
it('resolves local range names in source scope and preserves absolute reference parts', () => {
  const other=source();other.defineName('Series', 'Source!B2:C2');other.defineName('Dates', 'Source!$B$3:$C$3');
  const group=other.sheet('src').sparklineGroups[0];group.sparklines[0].formula='Series';group.dateFormula='Dates';
  const wb=new Workbook(), id=wb.activeSheetId;wb.defineName('Series',`${wb.sheet(id).name}!A1:A2`);
  placeImport(wb,id,other,{mode:'cell',otherSheetId:'src',at:{r:4,c:2}});
  expect(wb.sheet(id).sparklineGroups[0]).toMatchObject({dateFormula:'$B$3:$C$3',sparklines:[{ref:'G6',formula:'D6:E6'},{ref:'C5',formula:'D6:E6'}]});
});
it('preserves native colors across different palettes and unchanged themes across matching palettes', () => {
  const other=source();other.sheet('src').sparklineGroups[0].colorSeries={theme:5,tint:.3};
  const wb=new Workbook(),id=wb.activeSheetId;wb.placeSheetAt(id,other,'src',0,0);
  expect(wb.sheet(id).sparklineGroups[0].colorSeries).toEqual({theme:5,tint:.3});
  other.colorPalette={theme:['#ffffff','#000000','#ffffff','#000000','#222222','#ff0000','#222222','#222222','#222222','#222222','#222222','#222222']};
  const expected=nativeSparklineData(other,'src',1,4).colors.series;
  wb.placeSheetAt(id,other,'src',5,0);
  expect(nativeSparklineData(wb,id,6,4).colors.series).toBe(expected);
  expect(wb.sheet(id).sparklineGroups[1].colorSeries.rgb).toBeTruthy();
});
it('appends after blank chart anchors and refuses protected placement atomically', () => {
  const other=source(),wb=new Workbook({sheets:[{id:'dest',sparklineGroups:[{sparklines:[{ref:'A8'}]}]}]});
  const before=wb.toJSON();wb.protectRange('dest',{r1:8,c1:0,r2:8,c2:0});const protectedBefore=wb.toJSON();
  expect(placeImport(wb,'dest',other,{mode:'append',otherSheetId:'src'})).toBeNull();expect(wb.toJSON()).toEqual(protectedBefore);
  wb.undo();expect(wb.toJSON()).toEqual(before);
  expect(placeImport(wb,'dest',other,{mode:'append',otherSheetId:'src'})).toMatch(/after row 8/);
  expect(wb.sheet('dest').sparklineGroups[1].sparklines[0].ref).toBe('E10');
});
it('ordinary block imports erase covered native charts in the same undo transaction', () => {
  const wb=source(),other=new Workbook({sheets:[{id:'plain',cells:{'0,0':{v:6}}}]}),before=wb.toJSON();
  wb.placeSheetAt('src',other,'plain',1,4);expect(wb.sheet('src').sparklineGroups[0].sparklines).toHaveLength(1);wb.undo();expect(wb.toJSON()).toEqual(before);
});
it('preserves dynamic names rather than freezing their current evaluated range', () => {
  const other=source();other.defineName('Growing', 'OFFSET(Source!B2,0,0,1,2)');
  other.sheet('src').sparklineGroups[0].sparklines[0].formula='Growing';
  const wb=new Workbook(),id=wb.activeSheetId;wb.placeSheetAt(id,other,'src',4,2);
  expect(wb.sheet(id).sparklineGroups[0].sparklines[0].formula).toBe('Source!Growing');
});
it('retains a named spill suffix so its source can resize after import', () => {
  const other=source();other.defineName('Spilled', 'Source!B2#');
  other.sheet('src').sparklineGroups[0].sparklines[0].formula='Spilled';
  const wb=new Workbook(),id=wb.activeSheetId;wb.placeSheetAt(id,other,'src',4,2);
  expect(wb.sheet(id).sparklineGroups[0].sparklines[0].formula).toBe('D6#');
});
