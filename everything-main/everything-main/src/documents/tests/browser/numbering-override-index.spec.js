import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const root='tests/fixtures/numbering-override-index/';
const refs=JSON.parse(readFileSync(root+'reference.json'));
const sequenceRoot='tests/fixtures/numbering-override-sequences/';
const nestedRef=JSON.parse(readFileSync(sequenceRoot+'nested-reference.json'));
const sequenceRef=JSON.parse(readFileSync(sequenceRoot+'reference.json'));
const cases=[{name:'nested',source:sequenceRoot+'nested.docx',images:nestedRef.pngSha256.map((_,i)=>sequenceRoot+`nested-native-${i+1}.png`)},...refs.map(r=>({name:r.name,source:root+r.name+'.docx',images:[root+r.name+'-native.png']})),
 {name:'sequences',source:sequenceRoot+'control.docx',images:sequenceRef.pngSha256.map((_,i)=>sequenceRoot+`native-${i+1}.png`)}];
for(const item of cases)test(`native override paint, editing and preservation: ${item.name}`,async({page},info)=>{
 test.setTimeout(180000);
 await page.goto('/playground.html',{waitUntil:'domcontentloaded'});
 await page.getByRole('textbox',{name:'Document text'}).waitFor({state:'attached',timeout:120000});await page.getByLabel('Open DOCX file').setInputFiles(item.source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(item.name==='sequences'?/^R01.1/:item.name==='nested'?/^S01.1/:/^Row 01/);await expect(input).toBeEditable();
 await expect(page.locator('canvas.canvas-page')).toHaveCount(item.images.length);
 const original=await input.inputValue();
 for(let i=0;i<item.images.length;i++){
  const stats=await page.locator('canvas.canvas-page').nth(i).evaluate(async(canvas,uri)=>{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const image=new Image();image.src=uri;await image.decode();
   const c=document.createElement('canvas');c.width=816;c.height=1056;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
   const native=ctx.getImageData(0,0,816,1056).data;ctx.clearRect(0,0,816,1056);ctx.drawImage(canvas,0,0,816,1056);const actual=ctx.getImageData(0,0,816,1056).data;
   let mismatch=0,count=0;
   for(let y=40;y<1000;y++)for(let x=40;x<740;x++)for(const[a,b]of[[native,actual],[actual,native]]){
    const n=(y*816+x)*4;if(a[n]>=128||a[n+1]>=128||a[n+2]>=128)continue;count++;let found=false;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=((y+dy)*816+x+dx)*4;if(b[j]<128&&b[j+1]<128&&b[j+2]<128)found=true;}
    if(!found)mismatch++;
   }
   return{count,mismatch};
  },'data:image/png;base64,'+readFileSync(item.images[i]).toString('base64'));
  await page.locator('canvas.canvas-page').nth(i).screenshot({path:info.outputPath(`actual-${i+1}.png`)});
  expect(stats.count).toBeGreaterThan(1000);expect(stats.mismatch/stats.count,JSON.stringify(stats)).toBeLessThan(.005);
 }
 const save=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await wait).saveAs(path);return path;};
 const parts=unzipSync(readFileSync(item.source));expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Added ');const editedText=await input.inputValue(),edited=await save('edited');
 const changed=unzipSync(readFileSync(edited));for(const[name,data]of Object.entries(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(data);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,editedText);await expect(input).toBeEditable();
});
test('export restarted full, mismatched and ignored overrides for native verification',async({page},info)=>{
 await page.goto('/playground.html',{waitUntil:'domcontentloaded'});
 await page.getByRole('textbox',{name:'Document text'}).waitFor({state:'attached',timeout:120000});
 const results=await page.evaluate(async data=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {TextDocument}=await import('/src/engine/model.js');const {listMarkers}=await import('/src/engine/numbering.js');const result=[];
  for(const label of ['R04.1','R08.1','R10.1']){
   const p=await DocxPackage.open(Uint8Array.from(data));const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
   d.select(d.text.indexOf(label));d.restartNumbering(9);result.push({label,markers:listMarkers(d.paragraphs,d.numbering).map(m=>m?.text),bytes:[...new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer())]});
  }return result;
 },[...readFileSync(sequenceRoot+'control.docx')]);
 writeFileSync(info.outputPath('expected-markers.json'),JSON.stringify(results.map(({label,markers})=>({label,markers})),null,2));
 for(const result of results){const i=sequenceRef.rows.findIndex(r=>r.label===result.label);expect(result.markers[i+1]).toBe('N9.4');writeFileSync(info.outputPath(result.label+'.docx'),Buffer.from(result.bytes));}
});
