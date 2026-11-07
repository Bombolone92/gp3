import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const root='tests/fixtures/shifted-inline-leading/',source=root+'controls.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync(root+'reference.json'));
test('matches native shifted text and inline image positions through editing',async({page},info)=>{
 test.setTimeout(180000);
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');
 const available=await page.evaluate(async()=>{try{await new FontFace('Native Arial probe','local("Arial")').load();return true;}catch{return false;}});
 test.skip(!available,'Native controls require installed Arial.');
 await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Text 0 Image 0/);await expect(input).toBeEditable();
 const check=async(currentBytes=bytes)=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
  const actual=await page.evaluate(async data=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{measureCanvasText,loadCanvasFonts}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
   const p=await DocxPackage.open(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   const l=layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables);
   return l.lines.filter(line=>line.fragments.some(f=>f.image)).map(line=>({
    text:line.fragments.filter(f=>!f.image&&f.text.trim()).map(f=>({text:f.text.trim(),x:(f.x+measureCanvasText(ctx,f.text.match(/^ */)[0],f).width)*.75,y:line.baseline*.75-(f.baselineShift||0)})),
    image:line.fragments.filter(f=>f.image).map(f=>({x:f.x*.75,y:(line.baseline-f.ascent)*.75,width:f.width*.75,height:f.image.height/12700}))[0]
   }));
  },currentBytes.toString('base64'));
  expect(actual).toHaveLength(ref.cases.length);
  for(const [i,c]of ref.cases.entries()){
   for(const t of c.text){const a=actual[i].text.find(x=>x.text===t.text);expect(a).toBeTruthy();for(const k of ['x','y'])expect(Math.abs(a[k]-t[k]),c.name+' '+t.text+' '+k).toBeLessThan(.2);}
   for(const k of ['x','y','width','height'])expect(Math.abs(actual[i].image[k]-c.image[k]),c.name+' image '+k).toBeLessThan(.2);
  }
  const ink=await page.locator('canvas.canvas-page').evaluateAll((canvases,cases)=>canvases.map((c,i)=>{
   const g=c.getContext('2d'),s=c.width/612,b=cases[i].image,x=(b.x+b.width/2)*s;
   return [b.y-1,b.y+1,b.y+b.height-1,b.y+b.height+1].map(y=>{const p=g.getImageData(Math.round(x),Math.round(y*s),1,1).data;return p[0]>150&&p[1]<80&&p[2]<80;});
  }),ref.cases);
  for(const [i,v]of ink.entries())expect(v,ref.cases[i].name+' painted image edges').toEqual([false,true,true,false]);
 };
 await check();const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');
 const after=unzipSync(readFileSync(edited));expectBodyEditParts(after,parts);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);await check();
 await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toBeEditable();await check(readFileSync(edited));
});
