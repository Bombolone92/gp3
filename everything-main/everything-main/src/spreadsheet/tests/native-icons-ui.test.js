// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { closeAllModals } from '../src/ui/modal.js';
import { buildPrintTable } from '../src/ui/print.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { conditionalIconNode } from '../src/ui/conditional-icon.js';
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const range = { r1: 0, c1: 0, r2: 4, c2: 0 };
function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  [0,25,50,75,100].forEach((v,r) => wb.setInput(id,r,0,String(v)));
  const xml = '<conditionalFormatting sqref="A1:A5"><cfRule type="iconSet" priority="1"><iconSet iconSet="5Arrows">'+[0,20,40,60,80].map(v=>`<cfvo type="percent" val="${v}"/>`).join('')+'</iconSet></cfRule></conditionalFormatting>';
  wb.addRule(id, readXlsxConditionalFormats(xml,{dxfs:[]})[0]);
  const {panel}=openConditionalFormatting({wb,sheetId:()=>id,range:()=>range,grid:{focus(){}}});
  const field=name=>panel.querySelector(`[aria-label="${name}"]`), submit=()=>panel.querySelector('form').requestSubmit();
  panel.querySelector('.names-main').click(); return { wb,id,panel,field,submit };
}
it('edits four boundaries with exact types, inclusivity and reversal, without changing untouched rules', () => {
  const {wb,panel,field,submit}=setup(),before=wb.toJSON(),version=wb.version;
  expect(field('Built-in icon set').value).toBe('5Arrows'); expect(field('Icon boundary 4').value).toBe('80');
  expect(field('Icon boundary 2 type').value).toBe('percent'); expect(panel.querySelector('.cf-preview img')).not.toBeNull();
  submit(); expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
  panel.querySelector('.names-main').click(); field('Icon boundary 2 type').value='num'; field('Icon boundary 2').value='55'; field('Icon boundary 2 comparison').value='gt'; field('Reverse icon order').checked=true; submit();
  expect(wb.activeSheet.rules[0]).toMatchObject({iconThreshold2Type:'num',iconThreshold2:'55',iconThreshold2Gte:false,iconReverse:true});
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('rejects blank, invalid numeric and formula boundaries atomically and focuses the field', () => {
  const {wb,field,submit}=setup(),before=wb.toJSON();
  for(const text of ['', '101', '-1', 'oops']) { field('Icon boundary 2').value=text;submit();expect(wb.toJSON()).toEqual(before);expect(document.activeElement).toBe(field('Icon boundary 2')); }
  field('Icon boundary 2 type').value=''; field('Icon boundary 2').value='=NO_SUCH_FUNCTION(';submit();expect(wb.toJSON()).toEqual(before);
  field('Icon boundary 2').value='=$C$1';submit();expect(wb.activeSheet.rules[0].iconThreshold2Type).toBeUndefined();expect(wb.activeSheet.rules[0].iconThreshold2).toBe('$C$1');
});
it('switches native families without retaining unused boundaries and clears native settings for predicates', () => {
  const {wb,panel,field,submit}=setup();field('Built-in icon set').value='3Signs';field('Built-in icon set').dispatchEvent(new Event('change'));submit();
  expect(wb.activeSheet.rules[0].iconSet).toBe('3Signs');expect(wb.activeSheet.rules[0].iconThreshold3Type).toBeUndefined();
  panel.querySelector('.names-main').click();field('Condition').value='gt';field('Condition').dispatchEvent(new Event('change'));field('Value').value='3';submit();
  expect(wb.activeSheet.rules[0].iconSet).toBeUndefined();expect(wb.activeSheet.rules[0].iconThreshold1Type).toBeUndefined();
});
it('uses the same bounded vector images in the grid helper and print, including icon-only cells', () => {
  const {wb,id}=setup();
  const looks=[0,1,2,3,4].map(r=>wb.conditionalStyle(id,r,0,wb.getValue(id,r,0)));
  expect(looks.map(icon=>conditionalIconNode(icon).getAttribute('src'))).toEqual(looks.map(icon=>icon.iconImage));
  for(const iconOnly of [false,true]) {
    wb.updateRule(id,wb.activeSheet.rules[0].id,{iconOnly});
    const table=buildPrintTable(wb,id),cells=[...table.querySelectorAll('tbody td')];
    expect(cells.map(cell=>cell.querySelector('img')?.getAttribute('src'))).toEqual(looks.map(icon=>icon.iconImage));
    expect(cells.map(cell=>cell.textContent.trim())).toEqual(iconOnly?Array(5).fill(''):['0','25','50','75','100']);
  }
});
it('preserves native family, thresholds, comparisons and source independence through HTML copies', () => {
  const {wb,id}=setup(),rows=[0,1,2,3,4],cells=wb.copyCells(id,rows,[0]),conditionalFormats=wb.copyConditionalFormats(id,rows,[0]);
  const texts=['0','25','50','75','100'];const html=cellsToHtml(texts.map(v=>[v]),cells,null,null,{r:0,c:0},{conditionalFormats});
  const copy=parseHtmlClipboard(html,texts.join('\n')),other=new Workbook();other.pasteCells(other.activeSheetId,copy.cells,0,2,copy.origin,null,{conditionalFormats:copy.conditionalFormats});
  expect(other.activeSheet.rules[0].iconSet).toBe('5Arrows');expect(rows.map(r=>other.conditionalStyle(other.activeSheetId,r,2,other.getValue(other.activeSheetId,r,2))?.iconIndex)).toEqual([0,1,2,3,4]);
  other.setInput(other.activeSheetId,4,2,'50');expect(other.conditionalStyle(other.activeSheetId,4,2,50).iconIndex).toBe(3);
});
it.each(['left', 'center', 'right'])('lets icon-only print content follow %s cell alignment without reserving a value slot', align => {
  const {wb,id}=setup();
  wb.setCells(id, [{r:0,c:0,cell:{v:0,s:{align,valign:'top'}}}]);
  wb.updateRule(id,wb.activeSheet.rules[0].id,{iconOnly:true});
  const cell=buildPrintTable(wb,id).querySelector('tbody td'), icon=cell.querySelector('img');
  expect(cell.style.textAlign).toBe(align);
  expect(icon.style.position).toBe('');
  expect(icon.style.marginRight).toBe('0px');
  expect(cell.classList.contains('constrained')).toBe(true);
  expect(cell.querySelector('.print-cell').style.alignContent).toBe('start');
  expect(cell.style.paddingLeft).not.toBe('22px');
  expect(cell.querySelector('.print-cell')?.style.paddingLeft).not.toBe('22px');
  wb.updateRule(id,wb.activeSheet.rules[0].id,{iconOnly:false});
  const withValue=buildPrintTable(wb,id).querySelector('tbody td');
  expect(withValue.querySelector('img').style.position).toBe('absolute');
  expect(withValue.textContent.trim()).toBe('0');
});
it('removes the inter-value gap for standalone native and glyph icons in the grid', () => {
  for(const iconImage of [undefined,'data:image/svg+xml,test']) {
    expect(conditionalIconNode({icon:'✓',iconImage,iconOnly:true}).style.marginRight).toBe('0px');
    expect(conditionalIconNode({icon:'✓',iconImage,iconOnly:false}).style.marginRight).toBe('');
  }
});
it('edits custom icons, category counts and activation formulas without changing untouched rules', () => {
  const {wb,id,panel,field,submit}=setup(); closeAllModals();
  wb.updateRule(id,wb.activeSheet.rules[0].id,{iconCustom:true,iconActiveFormula:'$C$1',iconReverse:true,
    ...Object.fromEntries([0,1,2,3,4].flatMap(i=>[[`icon${i}Set`,i===2?'NoIcons':'3Stars'],[`icon${i}Id`,i===2?0:i%3]]))});
  const view=openConditionalFormatting({wb,sheetId:()=>id,range:()=>range,grid:{focus(){}}}).panel;
  const f=name=>view.querySelector(`[aria-label="${name}"]`),save=()=>view.querySelector('form').requestSubmit();
  view.querySelector('.names-main').click(); const before=wb.toJSON(),version=wb.version;
  expect(f('Customize icons').checked).toBe(true);expect(f('Reverse icon order').disabled).toBe(true);expect(f('Icon category 3').value).toBe('NoIcons:0');
  expect(f('Show icons when').value).toBe('=$C$1');save();expect(wb.toJSON()).toEqual(before);expect(wb.version).toBe(version);
  view.querySelector('.names-main').click(); f('Show icons when').value='bad';save();expect(wb.toJSON()).toEqual(before);expect(document.activeElement).toBe(f('Show icons when'));
  f('Show icons when').value='=C1>0';f('Built-in icon set').value='3Arrows';f('Built-in icon set').dispatchEvent(new Event('change'));
  f('Icon category 2').value='5Boxes:4';save();expect(wb.activeSheet.rules[0]).toMatchObject({iconSet:'3Arrows',icon1Set:'5Boxes',icon1Id:4,iconActiveFormula:'C1>0'});
  expect(wb.activeSheet.rules[0].icon3Set).toBeUndefined();wb.undo();expect(wb.toJSON()).toEqual(before);
});
it('prints NoIcons categories as empty cells in icon-only mode and preserves custom choices through HTML',()=>{
  const {wb,id}=setup();wb.updateRule(id,wb.activeSheet.rules[0].id,{iconCustom:true,iconOnly:true,
    ...Object.fromEntries([0,1,2,3,4].flatMap(i=>[[`icon${i}Set`,'NoIcons'],[`icon${i}Id`,0]]))});
  const cells=[...buildPrintTable(wb,id).querySelectorAll('tbody td')];
  expect(cells.every(cell=>cell.textContent.trim()===''&&!cell.querySelector('img'))).toBe(true);
  const rows=[0,1,2,3,4],raw=wb.copyCells(id,rows,[0]),conditionalFormats=wb.copyConditionalFormats(id,rows,[0]);
  const copy=parseHtmlClipboard(cellsToHtml(rows.map(r=>[String(r*25)]),raw,null,null,{r:0,c:0},{conditionalFormats})),other=new Workbook();
  other.pasteCells(other.activeSheetId,copy.cells,0,2,copy.origin,null,{conditionalFormats:copy.conditionalFormats});
  expect(other.activeSheet.rules[0]).toMatchObject({iconCustom:true,icon2Set:'NoIcons',icon2Id:0,iconOnly:true});
  expect(other.conditionalStyle(other.activeSheetId,2,2,50)).toMatchObject({icon:'',iconImage:null,iconOnly:true});
});
it('seeds customized categories from the selected family and its visible reverse order',()=>{
  const {wb,field,submit}=setup();field('Reverse icon order').checked=true;
  field('Customize icons').checked=true;field('Customize icons').dispatchEvent(new Event('change'));
  expect(field('Icon category 1').value).toBe('5Arrows:4');expect(field('Icon category 5').value).toBe('5Arrows:0');
  submit();expect(wb.activeSheet.rules[0]).toMatchObject({iconCustom:true,icon0Id:4,icon4Id:0});
});
