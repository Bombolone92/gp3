import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';

test.use({permissions:['local-fonts']});
const folder='tests/fixtures/opentype-kerning/';
const legacyCases=JSON.parse(readFileSync(folder+'legacy-cases.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function positions(page,source){
 await page.goto('/playground.html');
 return page.evaluate(async encoded=>{
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {layoutDocument}=await import('/src/engine/layout.js');
  const {pageGeometry}=await import('/src/engine/page-settings.js');
  const {fontAvailable}=await import('/src/engine/font-availability.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));await validateCanvasLayout(pkg);
  const ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories,{styles:pkg.styles});
  return layout.lines.map(l=>({x:l.fragments[0].x*.75,y:792-l.baseline*.75,text:l.fragments.map(f=>f.text).join(''),available:fontAvailable(l.fragments[0].fontFamily),family:l.fragments[0].fontFamily}));
 },readFileSync(source).toString('base64'));
}
const controls=[false,true].flatMap(extended=>[0,1].map(enabled=>({extended,enabled,
 name:`${extended?'eight':'four'}-font OpenType ${enabled}`,
 source:extended?`${folder}legacy-${enabled}.docx`:`public/fixtures/opentype-kerning-${enabled}.docx`,
 pdf:folder+(extended?`legacy-${enabled}-native.pdf`:`native-${enabled}.pdf`),
 reference:JSON.parse(readFileSync(folder+(extended?'legacy-reference.json':'reference.json'))).cases[enabled],
})));
for(const reference of JSON.parse(readFileSync(folder+'spacing-reference.json')).cases)controls.push({extended:true,enabled:1,name:`eight-font ${reference.name} spacing`,source:`${folder}legacy-spacing-${reference.name}.docx`,pdf:`${folder}legacy-spacing-${reference.name}-native.pdf`,reference});
for(const {extended,enabled,name,source,pdf,reference} of controls){
 test(`${name}: native positions`,async({page})=>{
  expect(sha(readFileSync(source))).toBe(reference.sourceSha256);
  expect(sha(readFileSync(pdf))).toBe(reference.pdfSha256);
  const actual=await positions(page,source);expect(actual).toHaveLength(reference.lines.length);let checked=0;
  for(const [i,line]of actual.entries()){
   expect(line.text.replace(/\s/g,'')).toBe(reference.lines[i].text.replace(/\s/g,''));
   if(!line.available)continue;
   // A separate expected-failure below retains the newly found pre-existing
   // GPOS-versus-legacy selection gap when OpenType is disabled in Palatino.
   if(extended&&!enabled&&legacyCases[i].family==='Palatino Linotype'&&legacyCases[i].text==='AVATAR To Wa')continue;
   expect(Math.abs(line.x-reference.lines[i].x),`${i} ${line.family}`).toBeLessThan(.2);
   expect(Math.abs(line.y-reference.lines[i].y),`${i} baseline`).toBeLessThan(.2);checked++;
  }
  expect(checked).toBeGreaterThan(0);
 });
 test(`${name}: editable package preservation and undo`,async({page},info)=>{
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^0123456789/);await expect(input).toHaveJSProperty('readOnly',false);
  const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
  const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(suffix+'.docx');await(await pending).saveAs(path);return path;};
  const check=(path,edited)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const name of Object.keys(parts))if(!edited||name!=='word/document.xml')expect(Buffer.from(out[name]).equals(Buffer.from(parts[name])),name).toBe(true);};
  check(await save('noedit'),false);await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await expect(input).toHaveValue('Edited '+original);
  const edited=await save('edited');check(edited,true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(await save('undo'),false);
  await reopenDocx(page,input,edited,'Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 });
}
test('Palatino disabled OpenType still needs legacy-versus-GPOS selection',async({page})=>{
 const actual=await positions(page,folder+'legacy-0.docx');const index=legacyCases.findIndex(c=>c.family==='Palatino Linotype'&&c.text==='AVATAR To Wa');
 test.skip(!actual[index].available,'Palatino is unavailable');test.fail(true,'Existing Canvas GPOS kerning differs from native legacy kerning with OpenType disabled.');
 const ref=JSON.parse(readFileSync(folder+'legacy-reference.json')).cases[0].lines[index];expect(Math.abs(actual[index].x-ref.x)).toBeLessThan(.2);
});
test('legacy-only primary fonts retain kerning and shaping in fallback glyphs',async({page})=>{
 await positions(page,folder+'legacy-1.docx');
 const result=await page.evaluate(async()=>{
  const {measureCanvasText,setCanvasTextStyle}=await import('/src/engine/canvas-text.js');
  const {openTypeKerningFamily}=await import('/src/engine/opentype-kerning.js');
  const ctx=document.createElement('canvas').getContext('2d'),style={fontFamily:'Goudy Old Style',fontSize:18,kerning:1,ligatures:'standardContextual'};
  const alias=openTypeKerningFamily(style);if(!alias)return null;
  const rows=['То','УА'].map(text=>({text,actual:measureCanvasText(ctx,text,style).width,expected:measureCanvasText(ctx,text,{...style,fontFamily:'Noto Sans'}).width,unkerned:measureCanvasText(ctx,text,{...style,fontFamily:'Noto Sans',kerning:0}).width}));
  setCanvasTextStyle(ctx,style);return {alias,kerning:ctx.fontKerning,rows};
 });
 test.skip(!result,'Authorized Goudy metadata is unavailable');expect(result.kerning).toBe('normal');
 for(const row of result.rows){expect(row.actual).toBeCloseTo(row.expected,4);expect(row.actual).toBeLessThan(row.unkerned);}
});
test('derived families retain normal, bold, italic and synthetic-bold advances',async({page})=>{
 await positions(page,folder+'legacy-1.docx');
 const rows=await page.evaluate(async()=>{
  const {measureCanvasText}=await import('/src/engine/canvas-text.js');
  const {openTypeKerningFamily}=await import('/src/engine/opentype-kerning.js');
  const ctx=document.createElement('canvas').getContext('2d'),rows=[];
  for(const fontFamily of ['Goudy Old Style','Garamond','Bell MT','Bodoni MT'])for(const bold of [false,true])for(const italic of [false,true]){
   const style={fontFamily,fontSize:18,bold,italic,kerning:1,ligatures:'standardContextual'};
   if(!openTypeKerningFamily(style))continue;
   rows.push({fontFamily,bold,italic,actual:measureCanvasText(ctx,'AVATAR To Wa',style).width,expected:measureCanvasText(ctx,'AVATAR To Wa',{...style,ligatures:'none',kerning:0}).width});
  }return rows;
 });
 expect(rows.length).toBeGreaterThan(0);for(const row of rows)expect(row.actual,JSON.stringify(row)).toBeCloseTo(row.expected,3);
});
