import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/shape-autofit-edges/',refs=JSON.parse(readFileSync(root+'reference.json'));
for(const [name,ref]of Object.entries(refs.variants))test(`native autofit group/geometry/spacing edges ${name}`,async({page},info)=>{
 test.setTimeout(90000);
 for(const [file,hash]of [[name+'.docx',ref.sourceSha256],[name+'-native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(root+name+'.docx');
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^mixed/);await expect(input).toHaveJSProperty('readOnly',false);await expect(page.locator('canvas.canvas-page')).toHaveCount(6);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{validateCanvasLayout,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const pkg=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(pkg);const c=document.createElement('canvas').getContext('2d');
  const l=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(c,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,undefined,{drawingLayouts:pkg.drawingLayouts});
  return l.pages.map((_,i)=>{
   const boxes=[],baselines={};
   const walk=(node,x,y,sx,sy,root=false)=>{
    if(!root){x+=node.x*sx;y+=node.y*sy;}
    if(node.type==='group'){sx*=node.width/node.childWidth;sy*=node.height/node.childHeight;for(const n of node.children)walk(n,x-node.childX*sx,y-node.childY*sy,sx,sy);}
    else if(node.fill)boxes.push({color:node.fill.replace('#',''),x,y,width:node.width*sx,height:node.height*sy});
   };
   for(const line of l.lines.filter(l=>l.page===i)){
    const text=line.fragments.map(f=>f.text).join('').trim();if(['Before','After'].includes(text))baselines[text]=line.baseline*.75;
    for(const f of line.fragments)if(f.image){const scene=pkg.assets[f.image.assetId].scene;walk(scene,f.x*.75,(line.baseline-f.ascent)*.75,f.image.width/12700/scene.width,f.image.height/12700/scene.height,true);}
   }
   return {boxes,baselines};
  });
 },[...readFileSync(root+name+'.docx')]);
 writeFileSync(info.outputPath('geometry.json'),JSON.stringify(actual,null,2));
 for(const [i,r]of ref.pages.entries()){
  expect(actual[i].boxes).toHaveLength(r.boxes.length);
  for(const [j,b]of r.boxes.entries()){const a=actual[i].boxes[j];expect(a.color).toBe(b.color);for(const k of ['x','y','width','height'])expect(Math.abs(a[k]-b[k]),`page ${i+1} box ${j+1} ${k}`).toBeLessThan(.2);}
  for(const [label,y]of Object.entries(r.baselines))expect(Math.abs(actual[i].baselines[label]-y),`page ${i+1} ${label}`).toBeLessThan(.2);
 }
 for(const i of [0,2,3,4,5])writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(await page.locator('canvas.canvas-page').nth(i).evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 await expect(page.locator('#playground-error')).toBeEmpty();
});
