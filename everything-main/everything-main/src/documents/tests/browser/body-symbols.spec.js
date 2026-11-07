import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/body-symbols/';
test('matches native symbol geometry and retains glyph identity through adjacent typing',async({page},info)=>{
 const source=readFileSync(root+'control.docx'),positions=JSON.parse(readFileSync(root+'native-positions.json','utf8'));
 const reference=JSON.parse(readFileSync(root+'reference.json','utf8').replace(/^\uFEFF/,''));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/playground.html');
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument,hitTest}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {fontAvailable}=await import('/src/engine/font-availability.js');
  const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
  return {native:['Arial','Wingdings','Symbol'].every(fontAvailable),pages:l.pageCount,lines:l.lines.map(line=>({page:line.page,x:line.stops[0].x*.75,baseline:line.baseline*.75,symbolX:line.stops.find(s=>s.offset===line.start+5)?.x*.75,rightX:line.stops.find(s=>s.offset===line.start+6)?.x*.75,
   start:line.start,hit:hitTest(l,line.page,line.stops.find(s=>s.offset===line.start+5).x+.01,line.y+line.height/2),text:line.fragments.map(f=>f.text).join('')}))};
 },[...source]);
 expect(actual.pages).toBe(1);expect(actual.lines).toHaveLength(14);
 writeFileSync(info.outputPath('native-position-comparison.json'),JSON.stringify({native:actual.native,lines:actual.lines.map((line,i)=>({...line,reference:positions[i],errors:Object.fromEntries(['x','baseline','symbolX','rightX'].map(key=>[key,line[key]-positions[i][key]]))}))},null,2));
 if(process.env.DOCX_NATIVE_FONTS_REQUIRED==='1')expect(actual.native,'Arial, Wingdings and Symbol must be available for this native verification').toBe(true);
 if(!actual.native)info.annotations.push({type:'font substitution',description:'Native symbol-coordinate assertions require Arial, Wingdings and Symbol.'});
 actual.lines.forEach((line,i)=>{
  expect(line.page).toBe(positions[i].page);expect(line.hit).toBe(line.start+5);
  if(actual.native){
   for(const key of ['x','baseline'])expect(Math.abs(line[key]-positions[i][key]),positions[i].label+' '+key).toBeLessThan(.2);
   // Consumer defaults now supply native kerning for the formerly failing
   // "11" label as well; require absolute positions, not only glyph advances.
   for(const key of ['symbolX','rightX'])expect(Math.abs(line[key]-positions[i][key]),positions[i].label+' '+key).toBeLessThan(.2);
   expect(Math.abs((line.rightX-line.symbolX)-(positions[i].rightX-positions[i].symbolX)),positions[i].label+' symbol advance').toBeLessThan(.2);
  }
 });
 expect(actual.lines[12].text).toContain('LaR');expect(actual.lines[13].text).toContain('LaR');
 await page.getByLabel('Open DOCX file').setInputFiles(root+'control.docx');const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/C14 L\ufffcR/);await expect(input).toHaveJSProperty('readOnly',false);const original=await input.inputValue();
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const parts=unzipSync(source);expect(unzipSync(readFileSync(await save('body-symbols-noedit')))).toEqual(parts);
 await input.evaluate(e=>{e.focus();e.setSelectionRange(6,6);e.dispatchEvent(new Event('select',{bubbles:true}));});await page.keyboard.insertText('Z');
 const edited=await save('body-symbols-edited'),output=unzipSync(readFileSync(edited));
 expect((strFromU8(output['word/document.xml']).match(/<w:sym\b/g)||[])).toHaveLength(14);
 for(const[name,bytes]of Object.entries(parts))if(name!=='word/document.xml')expect(output[name]).toEqual(bytes);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('body-symbols-undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,original.slice(0,6)+'Z'+original.slice(6));await expect(input).toHaveJSProperty('readOnly',false);expect(errors).toEqual([]);
});
