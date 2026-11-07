import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/empty-table-fragment.docx';
const refs=JSON.parse(readFileSync('tests/fixtures/empty-table-fragment/reference.json'));
test('matches native page-boundary borders and keeps editable round trips',async({page},info)=>{
 test.setTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Case 0/);await expect(input).toHaveJSProperty('readOnly',false);
 const canvases=page.locator('canvas.canvas-page');await expect(canvases).toHaveCount(18);
 const checkBorders=async()=>{
  const rows=await canvases.evaluateAll(cs=>cs.map(c=>{
   const {data}=c.getContext('2d').getImageData(0,0,c.width,c.height),ys=[];
   for(let y=0;y<c.height;y++){let count=0;for(let x=0;x<c.width;x++){const at=(y*c.width+x)*4;if(data[at]<60&&data[at+1]>80&&data[at+1]<180&&data[at+2]>80&&data[at+2]<180)count++;}if(count>100)ys.push(y);}
   return ys;
  }));
  refs.forEach((r,i)=>{if(!r.borderRows.length)expect(rows[i],`page ${i+1}`).toEqual([]);else{expect(rows[i].length,`page ${i+1}`).toBeGreaterThan(0);expect(Math.abs(rows[i][0]-r.borderRows[0])).toBeLessThanOrEqual(1);expect(Math.abs(rows[i].at(-1)-r.borderRows.at(-1))).toBeLessThanOrEqual(1);}});
 };
 await expect(async()=>checkBorders()).toPass();
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(source)),original=await input.inputValue();
 expect(unzipSync(readFileSync(await download('unchanged.docx')))).toEqual(parts);
 await input.evaluate(el=>{const at=el.value.indexOf('C0X0');el.focus();el.setSelectionRange(at,at);el.dispatchEvent(new Event('select'));});await page.keyboard.insertText('Edited ');
 await expect(input).toHaveValue(original.replace('C0X0','Edited C0X0'));
 const edited=await download('edited.docx'),changed=unzipSync(readFileSync(edited));for(const key of Object.keys(parts))if(key!=='word/document.xml')expect(changed[key]).toEqual(parts[key]);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await download('undo.docx')))).toEqual(parts);
 await reopenDocx(page,input,edited,original.replace('C0X0','Edited C0X0'));await expect(canvases).toHaveCount(18);await expect(async()=>checkBorders()).toPass();
 const png=await canvases.nth(0).evaluate(c=>c.toDataURL());writeFileSync(info.outputPath('first-page.png'),Buffer.from(png.split(',')[1],'base64'));expect(errors).toEqual([]);
});
