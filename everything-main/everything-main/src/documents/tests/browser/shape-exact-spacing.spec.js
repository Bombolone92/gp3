import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const source='public/fixtures/shape-exact-spacing.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/shape-exact-spacing/reference.json','utf8'));
test.use({deviceScaleFactor:3});
test('matches native shape-exact-spacing ink and preserves shape markup through edit, reopen and undo',async({page},info)=>{
 test.setTimeout(120000);
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Text box line spacing controls/,{timeout:45000});await expect(input).toHaveJSProperty('readOnly',false);
 const check=async()=>{
  await expect(page.locator('#playground-error')).toBeEmpty();await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const bands=await page.evaluate(cases=>{
   const canvas=document.querySelector('canvas.canvas-page'),ctx=canvas.getContext('2d'),scale=canvas.width/612;
   return cases.map(({x,y})=>{
    const left=Math.round(x*scale),top=Math.round(y*scale),w=Math.round(200*scale),h=Math.round(110*scale);
    const data=ctx.getImageData(left,top,w,h).data,result=[];
    for(let py=0;py<h;py++){
     let ink=false;for(let px=0;px<w;px++){const k=(py*w+px)*4;const [r,g,b]=data.slice(k,k+3);if(b>r+25&&b>g+12&&r<100){ink=true;break;}}
     if(ink){if(!result.length||py>result.at(-1)[1]+1)result.push([py,py]);else result.at(-1)[1]=py;}
    }
    return result.map(([a,b])=>[(top+a)/scale,(top+b+1)/scale]);
   });
  },reference.cases);
  for(const [i,c] of reference.cases.entries()){
   expect(bands[i].length,JSON.stringify(bands)).toBe(c.bands.length);
   for(let j=0;j<c.bands.length;j++)for(let k=0;k<2;k++)expect(Math.abs(bands[i][j][k]-c.bands[j][k]),`case ${i}: ${JSON.stringify(bands[i])}`).toBeLessThan(1);
  }
 };
 await check();writeFileSync(info.outputPath('shape-exact-spacing.png'),Buffer.from(await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 const original=await input.inputValue();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Edited ');await check();
 const save=async suffix=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(`shape-exact-spacing${suffix}.docx`);await(await pending).saveAs(path);return path;};
 const edited=await save('-edited');await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);await check();
 const a=unzipSync(readFileSync(source)),b=unzipSync(readFileSync(await save('-undo')));for(const name of Object.keys(a))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);
 const savedXml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);
 const sourceXml=new TextDecoder().decode(unzipSync(readFileSync(source))['word/document.xml']);
 const groups=xml=>xml.match(/<(?:[\w]+:)?wsp\b[\s\S]*?<\/(?:[\w]+:)?wsp>/g);
 expect(groups(sourceXml)).toHaveLength(8);expect(groups(savedXml)).toEqual(groups(sourceXml));
 const previous=await input.elementHandle();page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);
 await expect.poll(()=>previous.evaluate(el=>el.isConnected),{timeout:45000}).toBe(false);await previous.dispose();
 await expect(input).toHaveValue('Edited '+original);await expect(input).toHaveJSProperty('readOnly',false);await check();
});

