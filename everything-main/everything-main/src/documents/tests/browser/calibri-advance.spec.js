import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test('independent native Calibri size and tracking controls retain screen carets through editing',async({page},info)=>{
 test.setTimeout(120000);
 const folder='tests/fixtures/calibri-advance/',source=folder+'control.docx',bytes=readFileSync(source);
 const cases=JSON.parse(readFileSync(folder+'cases.json','utf8'));
 const native=JSON.parse(readFileSync(folder+'native-carets.json','utf8'));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(cases.sourceSha256);
 expect(native.sourceSha256).toBe(cases.sourceSha256);
 expect(native.savedBefore&&native.savedAfter&&native.sourceUnchanged).toBe(true);
 await page.goto('/playground.html');
 await page.evaluate(async()=>{
  const {CanvasEditor}=await import('/tools/reviewed-family-modules.js'),original=CanvasEditor.prototype.relayout;
  CanvasEditor.prototype.relayout=function(...args){const result=original.apply(this,args);window.advanceEditor=this;return result;};
 });
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/EEEEEEEEEEEE/);await expect(input).toHaveJSProperty('readOnly',false);
 const verify=async()=>{
  const actual=await page.evaluate(()=>window.advanceEditor.layout.lines.map(line=>({
   text:line.fragments.map(f=>f.text||'').join(''),stops:line.stops.map(s=>({index:s.offset-line.start,xPt:s.x*.75}))
  })));
  expect(actual).toHaveLength(8);
  for(const[i,row]of actual.entries()){
   expect(row.text).toBe(cases.cases[i].text);
   expect(native.rows[i].sizePt).toBe(cases.cases[i].sizePt);
   expect(native.rows[i].spacingPt).toBe(cases.cases[i].spacingPt);
   expect(native.rows[i].bold===-1).toBe(cases.cases[i].bold);
   expect(row.stops).toHaveLength(13);
   for(const stop of row.stops)expect(Math.abs(stop.xPt-native.rows[i].carets[stop.index].xPt),`${i}/${stop.index}`).toBeLessThan(.4);
  }
  writeFileSync(info.outputPath('screen-carets.json'),JSON.stringify(actual,null,2));
 };
 await verify();
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async(name,edited=false)=>{
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();
  const output=info.outputPath(name+'.docx');await(await pending).saveAs(output);
  const result=unzipSync(readFileSync(output));expect(Object.keys(result).sort()).toEqual(Object.keys(parts).sort());
  for(const[key,value]of Object.entries(parts))if(!edited||key!=='word/document.xml')expect(result[key],key).toEqual(value);
  return output;
 };
 await save('noedit');await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT');
 const changed=await input.inputValue(),edited=await save('edited',true);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await verify();await save('undo');
 await reopenDocx(page,input,edited,changed);await expect(page.locator('#playground-error')).toBeEmpty();
});
