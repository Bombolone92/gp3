import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const folder='tests/fixtures/fixed-table-reduction/';
for(const [stem,native] of [['rows','rows-native'],['source','native'],['margins','margins-native']]){
const source=folder+stem+'.docx';
const ref=JSON.parse(readFileSync(folder+native+'-reference.json','utf8').replace(/^\uFEFF/,''));
test(`keeps native ${stem} widths through painting, editing, undo and reopen`,async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(new RegExp('^'+ref.tables[0].name));await expect(input).toHaveJSProperty('readOnly',false);
 const check=async bytes=>{
  const cells=await page.evaluate(async bytes=>{
   const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
   const p=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d');
   return layoutDocument(p.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(p.pageSettings),p.numbering,p.tables).cells.map(c=>({left:c.x*.75,width:c.width*.75,top:c.y*.75,height:c.height*.75,paddingLeft:c.margins.left/20,paddingRight:c.margins.right/20}));
  },[...bytes]);
  const expected=ref.tables.flatMap(t=>t.cells);
  expect(cells).toHaveLength(expected.length);
  cells.forEach((c,i)=>expect(Math.abs(c.width-expected[i].widthPt),`cell ${i} native width`).toBeLessThan(.2));
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  // Use blank padding where available; near-minimum cells can have a glyph
  // at the usual right-interior sample. Stay clear of editing guides as well.
  const colors=await page.locator('canvas.canvas-page').evaluate((canvas,cells)=>{
   const ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return cells.map(c=>{
    const x=c.paddingLeft>=3?c.left+c.paddingLeft/2:c.paddingRight>=3?c.left+c.width-c.paddingRight/2:c.left+c.width-3;
    return Array.from(ctx.getImageData(Math.round(x*scale),Math.round((c.top+c.height/2)*scale),1,1).data).slice(0,3);
   });
  },cells.map((c,i)=>({...c,width:expected[i].widthPt})));
  const palette=[[51,102,153],[204,102,51],[102,153,51],[170,187,204]];
  // A one-point cell has no interior pixel clear of glyphs and editing guides.
  // Its exact minimum width is still checked against the native reference above.
  colors.forEach((color,i)=>{if(expected[i].widthPt>=6)expect(color,`cell ${i} paint`).toEqual(palette[expected[i].column-1]);});
 };
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));await check(readFileSync(source));
 writeFileSync(info.outputPath('page.png'),Buffer.from((await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL())).split(',')[1],'base64'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edit ');
 const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await check(readFileSync(edited));await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
 expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'Edit '+original);await check(readFileSync(edited));
 await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});
}
