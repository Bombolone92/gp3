import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
test.use({permissions:['local-fonts']});
const folder='tests/fixtures/legacy-kerning-pairs/',cases=JSON.parse(readFileSync(folder+'cases.json')),reference=JSON.parse(readFileSync(folder+'reference.json'));
const pending=new Set([4,7,12,13]);
async function measure(page,enabled){
 const bytes=readFileSync(folder+`control-${enabled}.docx`),ref=reference.controls[enabled];
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(bytes)).toBe(ref.sourceSha256);expect(hash(readFileSync(folder+`native-${enabled}.pdf`))).toBe(ref.pdfSha256);
 await page.goto('/playground.html');
 const rows=await page.evaluate(async bytes=>{
  const{DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{fontAvailable}=await import('/src/engine/font-availability.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(pkg);const ctx=document.createElement('canvas').getContext('2d');
  return layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings)).lines.map(l=>({page:l.page,x:l.fragments[0].x*.75,y:792-l.baseline*.75,text:l.fragments.map(f=>f.text).join(''),available:fontAvailable(l.fragments[0].fontFamily)}));
 },[...bytes]);
 expect(rows).toHaveLength(56);
 for(const[i,row]of rows.entries()){expect(row.text).toBe(cases[i].text);expect(row.page).toBe(cases[i].page);}
 return rows;
}
for(const enabled of [0,1]){
 test(`OpenType ${enabled}: pair and internal-space origins`,async({page},info)=>{
  const rows=await measure(page,enabled);let checked=0;
  test.skip(rows.every(row=>!row.available),'Requires at least one installed native reference family.');
  writeFileSync(info.outputPath('positions.json'),JSON.stringify(rows,null,2));
  for(const[i,row]of rows.entries()){
   if(!row.available||!enabled&&pending.has(i))continue;
   expect(Math.abs(row.x-reference.controls[enabled].lines[i].x),`${cases[i].family}: ${row.text}`).toBeLessThan(.2);
   expect(Math.abs(row.y-reference.controls[enabled].lines[i].y)).toBeLessThan(.2);checked++;
  }expect(checked).toBeGreaterThan(0);
 });
 test(`OpenType ${enabled}: editable pair control preserves package and undo`,async({page},info)=>{
  await page.goto('/playground.html');const source=folder+`control-${enabled}.docx`,parts=unzipSync(readFileSync(source));
  await page.getByLabel('Open DOCX file').setInputFiles(source);const input=page.getByRole('textbox',{name:'Document text'});
  await expect(input).toHaveValue(/^AV\nVA\n/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
  const original=await input.inputValue();
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
  const check=(path,edited=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
  check(await save('noedit'));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');const edited=await save('edited');check(edited,true);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(await save('undo'));await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(2);
 });
}
test('pending legacy Palatino pairs include internal spaces',async({page})=>{
 const rows=await measure(page,0);test.skip(!rows[0].available,'Requires Palatino Linotype.');
 const deltas=[...pending].map(i=>Math.abs(rows[i].x-reference.controls[0].lines[i].x));
 test.fail(true,'Legacy pair selection and internal-space kerning still differ from the native reference; wholesale GPOS removal is not a safe fix.');
 expect(Math.max(...deltas)).toBeLessThan(.2);
});
