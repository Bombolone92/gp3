import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
const refs=JSON.parse(readFileSync('tests/fixtures/table-unbreakable/reference.json','utf8'));
for(const ref of refs)test(`matches native AutoFit overflow: ${ref.name}`,async({page},info)=>{
 test.setTimeout(120000);
 const source=`public/fixtures/${ref.name}.docx`,bytes=readFileSync(source),errors=[];page.on('pageerror',e=>errors.push(e.message));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(`tests/fixtures/table-unbreakable/${ref.name}.pdf`)).digest('hex')).toBe(ref.pdfSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^AutoFit /);await expect(input).toHaveJSProperty('readOnly',false);
 const geometry=await page.evaluate(async b=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');
  const pkg=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));await loadCanvasFonts(pkg);const ctx=document.createElement('canvas').getContext('2d');
  const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables),cell=layout.cells[0];
  const content=layout.lines.filter(l=>l.cellId===cell.id).flatMap(l=>l.fragments.map(f=>({line:l,fragment:f}))).sort((a,b)=>b.fragment.width-a.fragment.width)[0];
  return {left:cell.x*.75,width:cell.width*.75,naturalWidth:content.fragment.width*.75,clip:content.line.cellClip,
   colors:Object.values(pkg.assets).find(a=>a.chart)?.chart.series.map(s=>s.fill)};
 },bytes.toString('base64'));
 expect(Math.abs(geometry.left-ref.left)).toBeLessThan(.2);expect(Math.abs(geometry.width-ref.width)).toBeLessThan(.2);
 if(ref.name.includes('-modern-')){expect(geometry.naturalWidth).toBeLessThan(geometry.width);expect(geometry.clip).toBeUndefined();}
 else {expect(geometry.naturalWidth).toBeGreaterThan(geometry.width);expect(geometry.clip.right*.75).toBeCloseTo(geometry.left+geometry.width,4);}
 if(!ref.name.endsWith('glyph'))expect(geometry.naturalWidth).toBeCloseTo(504,4);
 const check=async()=>{
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);await expect(page.locator('#playground-error')).toBeEmpty();
  await expect.poll(()=>page.locator('canvas.canvas-page').evaluate((canvas,{ref,colors,name})=>{
   const ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   const wanted=new Set((name.endsWith('chart')?colors:name.endsWith('picture')?['#1e5ab4','#f59623']:['#000000']).map(c=>parseInt(c.slice(1),16)));
   let inside=0,outside=0;const right=Math.ceil((ref.left+ref.width+2)*canvas.width/612),left=Math.ceil(ref.left*canvas.width/612);
   for(let y=0;y<canvas.height;y++)for(let x=left;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(wanted.has((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2])){if(x>=right)outside++;else inside++;}}
   return {visible:inside>100,outside};
  },{ref,colors:geometry.colors,name:ref.name})).toEqual({visible:true,outside:0});
 };await check();
 writeFileSync(info.outputPath('page.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue(),parts=unzipSync(bytes);
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const same=(actual,edit=false)=>{expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());if(edit)expectBodyEditParts(actual,parts);else for(const n of Object.keys(parts))expect(Buffer.from(actual[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
 same(unzipSync(readFileSync(await save('noedit'))));await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');
 const edited=await save('edited');same(unzipSync(readFileSync(edited)),true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);same(unzipSync(readFileSync(await save('undo'))));await check();
 await reopenDocx(page,input,edited,'EDIT '+original);await check();expect(errors).toEqual([]);
});
