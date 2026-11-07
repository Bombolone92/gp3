import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test('optional-ligature carets follow native reference positions through pointer selection, edits and undo',async({page},info)=>{
 test.setTimeout(120000);
 const folder='tests/fixtures/contextual-caret-boundaries/',source=folder+'control.docx',bytes=readFileSync(source);
 const ref=JSON.parse(readFileSync(folder+'native-carets.json','utf8').replace(/^\uFEFF/,''));
 const sha=data=>createHash('sha256').update(data).digest('hex');
 expect(sha(bytes)).toBe(ref.sourceSha256);expect(sha(readFileSync(folder+'native-page.emf'))).toBe(ref.nativePageSha256);
 expect(ref.savedBefore&&ref.savedAfter&&ref.sourceUnchanged).toBe(true);
 await page.goto('/playground.html');
 await page.evaluate(async()=>{
  const {CanvasEditor}=await import('/tools/reviewed-family-modules.js'),original=CanvasEditor.prototype.relayout;
  CanvasEditor.prototype.relayout=function(...args){const result=original.apply(this,args);window.reviewedFamilyEditor=this;return result;};
 });
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^office/);await expect(input).toHaveJSProperty('readOnly',false);
 const verify=async()=>{
  const actual=await page.evaluate(async()=>{
   const editor=window.reviewedFamilyEditor;
   const {caretRect,selectionRects,hitTest}=await import('/src/engine/layout.js');
   return editor.layout.lines.map(line=>({text:line.fragments.map(f=>f.text).join(''),start:line.start,
    stops:line.stops.map(s=>({offset:s.offset,index:s.offset-line.start,xPt:caretRect(editor.layout,s.offset).x*.75,
     hit:hitTest(editor.layout,line.page,s.x,line.y+line.height/2)})),
    selected:selectionRects(editor.layout,line.start+1,line.start+2)[0]}));
  });
  expect(actual).toHaveLength(4);
  for(const[i,line]of actual.entries()){
   expect(line.text).toBe(ref.rows[i].text);expect(line.stops).toHaveLength(ref.rows[i].carets.length);
   for(const stop of line.stops){
    expect(Math.abs(stop.xPt-ref.rows[i].carets[stop.index].xPt),`${i}/${stop.index}`).toBeLessThan(.5);
    expect(stop.hit).toBe(stop.offset);
   }
   expect(line.selected.x*.75).toBeCloseTo(line.stops[1].xPt,6);
   expect(line.selected.width*.75).toBeCloseTo(line.stops[2].xPt-line.stops[1].xPt,6);
  }
  writeFileSync(info.outputPath('native-carets.json'),JSON.stringify(actual,null,2));return actual;
 };
 const actual=await verify(),original=await input.inputValue(),parts=unzipSync(bytes);
 const point=await page.evaluate(()=>{const e=window.reviewedFamilyEditor,line=e.layout.lines[1],r=e.canvases[0].getBoundingClientRect();return{x:r.left+line.stops[1].x*e.zoom,y:r.top+(line.y+line.height/2)*e.zoom};});
 await page.mouse.click(point.x,point.y);await expect(input).toHaveJSProperty('selectionStart',actual[1].start+1);
 await input.press('Shift+ArrowRight');await expect(input).toHaveJSProperty('selectionEnd',actual[1].start+2);
 const save=async(name,edited=false)=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);const exported=unzipSync(readFileSync(path));expect(Object.keys(exported).sort()).toEqual(Object.keys(parts).sort());for(const[key,data]of Object.entries(parts))if(!edited||key!=='word/document.xml')expect(exported[key],key).toEqual(data);return path;};
 await save('noedit');await input.focus();await page.keyboard.insertText('EDIT');
 const changed=await input.inputValue(),edited=await save('edited',true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await save('undo');await verify();
 await reopenDocx(page,input,edited,changed);await expect(page.locator('#playground-error')).toBeEmpty();
});
