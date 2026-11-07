import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {openReadOnlyPreview} from './helpers/preview.js';
const folder='tests/fixtures/style-identity-recovery/';
const variants=['missing','paragraph','character','default','table','cross-type','combined','companion','companion-only'];

test('style identity recovery retains complete healthy formatting and geometry',async({page},info)=>{
 test.setTimeout(240000);
 await page.goto('/playground.html',{waitUntil:'domcontentloaded'});
 const inputs=Object.fromEntries(['healthy',...variants].map(name=>[name,[...readFileSync(`${folder}${name}.docx`)]]));
 const rendered=await page.evaluate(async inputs=>{
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const result={};
  for(const[name,bytes]of Object.entries(inputs)){
   const {pkg,images}=await openCanvasDocument(Uint8Array.from(bytes));
   const host=document.createElement('div');document.body.append(host);const errors=[];
   const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
   result[name]={readOnly:!!pkg.readOnly,styles:Object.keys(pkg.styles.definitions).length,tables:pkg.tables.length,images:images.size,errors,
    png:editor.canvases.map(c=>c.toDataURL()),lines:[...editor.layout.lines,...editor.storyLayout.lines].map(l=>({page:l.page,y:l.y,baseline:l.baseline,height:l.height,
     fragments:l.fragments.map(f=>({text:f.text,x:f.x,width:f.width,bold:f.bold,color:f.color}))}))};
   editor.destroy();host.remove();
  }
  return result;
 },inputs);
 expect(rendered.healthy.readOnly).toBe(false);
 for(const name of variants){
  const actual=rendered[name];expect(actual.readOnly,name).toBe(true);
  expect(actual.styles,name).toBe(2);expect(actual.tables,name).toBe(2);expect(actual.images,name).toBe(2);
  expect(actual.errors,name).toEqual([]);
  expect(actual.lines,name).toEqual(rendered.healthy.lines);expect(actual.png,name).toEqual(rendered.healthy.png);
 }
 for(const[i,png]of rendered.combined.png.entries())writeFileSync(info.outputPath(`recovered-${i+1}.png`),Buffer.from(png.split(',')[1],'base64'));
});

test('style identity issues are localized and the download preserves original bytes',async({page})=>{
 test.setTimeout(120000);
 await page.goto('/playground.html',{waitUntil:'domcontentloaded'});
 await openReadOnlyPreview(page,`${folder}combined.docx`);
 const banner=page.locator('details').filter({hasText:'Unsupported features detected'});
 await banner.locator('summary').click();
 await expect(banner).toContainText('duplicate style ID BadParagraph');
 await expect(banner).toContainText('duplicate style ID BadTable');
 await expect(banner).toContainText('style without an ID');
});
