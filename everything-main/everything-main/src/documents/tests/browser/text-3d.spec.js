import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const folder='tests/fixtures/text-3d/', source=folder+'control.docx';
const bytes=readFileSync(source), reference=JSON.parse(readFileSync(folder+'reference.json'));
const grid=JSON.parse(readFileSync(folder+'native-surface-grid.json'));
test.use({deviceScaleFactor:4,permissions:['local-fonts']});

test('text 3D native controls render bevel lighting while retaining ordinary flow',async({page},info)=>{
  test.setTimeout(120000);
  for(const [name,hash] of [['control.docx',reference.sourceSha256],['native.pdf',reference.pdfSha256]])
    expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const available=await page.evaluate(async()=>{try{await new FontFace('Native control probe','local("Arial")').load();return true;}catch{return false;}});
  test.skip(!available,'Requires installed Arial; no font binaries are distributed.');
  const input=page.getByRole('textbox',{name:'Document text'}), old=await input.elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await page.waitForFunction(el=>!el.isConnected,old);await old.dispose();
  await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(10);
  await expect(page.locator('#playground-error')).toHaveText('');
  const lines=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js'),{measureCanvasText,loadCanvasFonts}=await import('/src/engine/canvas-text.js');
    const pkg=await DocxPackage.open(new Uint8Array(bytes));await loadCanvasFonts(pkg);
    const ctx=document.createElement('canvas').getContext('2d');
    return layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables).lines
      .filter(l=>l.fragments.map(f=>f.text).join('').startsWith('Following text'))
      .map(l=>l.baseline*.75);
  },[...bytes]);
  expect(lines).toHaveLength(10);
  for(let i=0;i<10;i++)expect(Math.abs(lines[i]-reference.records[i].followingOriginPt[1])).toBeLessThan(.2);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const results=await page.locator('canvas.canvas-page').evaluateAll((canvases,records)=>records.map((record,i)=>{
    const canvas=canvases[i],ctx=canvas.getContext('2d'),scale=canvas.width/612;
    const samples=record.samples.map(s=>{
      const actual=[...ctx.getImageData(Math.round(s.xPt*scale),Math.round(s.yPt*scale),1,1).data].slice(0,3);
      return {...s,actual,error:Math.max(...actual.map((c,i)=>Math.abs(c-s.rgb[i])))};
    });
    return {name:record.name,maxError:Math.max(...samples.map(s=>s.error)),samples};
  }),reference.records.map((record,i)=>({...record,samples:[...record.samples,...grid[i].samples.map(([xPt,yPt,...rgb])=>({xPt,yPt,rgb}))]})));
  await info.attach('native-surface-comparison',{body:JSON.stringify(results,null,2),contentType:'application/json'});
  for(const result of results)expect.soft(result.maxError,result.name).toBeLessThanOrEqual(4);
});

test('text remains editable when access to installed font outlines is unavailable',async({page,context})=>{
  await context.clearPermissions();
  await page.goto('/playground.html');
  const input=page.getByRole('textbox',{name:'Document text'}),old=await input.elementHandle();
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await page.waitForFunction(el=>!el.isConnected,old);await old.dispose();
  await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(10);
  await expect(page.locator('#playground-error')).toHaveText('');
  const original=await input.inputValue();
  await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Test ');
  await expect(input).toHaveValue('Test '+original);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);
});
