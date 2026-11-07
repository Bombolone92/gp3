import {showAllTools} from './helpers/editor-tools.js';
import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/mixed-page-sizes.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/mixed-page-sizes/reference.json','utf8'));
test('renders and edits mixed paper sizes with native reference geometry',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(reference.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/mixed-page-sizes/native.pdf')).digest('hex')).toBe(reference.pdfSha256);
 await page.goto('/playground.html');await showAllTools(page);await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
 const actual=await page.evaluate(async bytes=>{
  const {DocxPackage}=await import('/src/engine/docx.js');const {loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js');const {layoutDocument}=await import('/src/engine/layout.js');const {layoutPageStories}=await import('/src/engine/page-story-layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d'),measure=(t,s)=>measureCanvasText(ctx,t,s);
  const body=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories);
  const story=layoutPageStories(body,p.pageStories,[...p.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionEnd),p.pageSettings],measure,p.numbering,{styles:p.styles});
  return [...body.lines,...story.lines].map(l=>({page:l.page,text:l.fragments.map(f=>f.text).join(''),x:l.fragments[0].x*.75,baseline:l.baseline*.75,
   closing:l.fragments.at(-1).text.endsWith(']')?(l.fragments.at(-1).x+measure(l.fragments.at(-1).text.slice(0,-1),l.fragments.at(-1)).width)*.75:null}));
 },readFileSync(source).toString('base64'));
 writeFileSync(info.outputPath('actual.json'),JSON.stringify(actual,null,2));
 for(const [i,data] of (await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>c.toDataURL()))).entries())writeFileSync(info.outputPath(`page${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
 for(const [i,refs] of reference.pages.entries()){
  const lines=actual.filter(l=>l.page===i),canvas=page.locator('canvas.canvas-page').nth(i);
  const size=await canvas.boundingBox();expect(size.width).toBeCloseTo(reference.sizes[i][0]*4/3,1);expect(size.height).toBeCloseTo(reference.sizes[i][1]*4/3,1);
  const plain=t=>t.replace(/\s/g,'');expect(plain(lines.map(l=>l.text).join(''))).toBe(plain(refs.map(l=>l.text).join('')));
  for(const l of lines){
   const r=refs.filter(r=>r.text.includes(l.text.trim())).sort((a,b)=>Math.abs(a.baseline-l.baseline)-Math.abs(b.baseline-l.baseline))[0];expect(r,l.text).toBeTruthy();
   expect(Math.abs(l.baseline-r.baseline),l.text+' baseline').toBeLessThanOrEqual(.2+1e-9); // Inclusive 0.2pt native bound with floating-point rounding.
   expect(Math.abs(l.x-r.glyphs[r.text.indexOf(l.text.trim())]),l.text+' origin').toBeLessThan(.3);
  }
 }
 await page.setViewportSize({width:2000,height:1000});
 await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1.5');
 const landscape=page.locator('canvas.canvas-page').nth(1);await landscape.evaluate(el=>el.scrollIntoView({block:'start',inline:'nearest'}));const box=await landscape.boundingBox(),target=actual.find(l=>l.page===1&&l.text==='Section 2 right edge'),scale=box.width/reference.sizes[1][0];
 await page.mouse.click(box.x+(target.x+2)*scale,box.y+(target.baseline-5)*scale);
 const start=(await input.inputValue()).indexOf('Section 2 right edge');expect(await input.evaluate(el=>el.selectionStart)).toBeGreaterThanOrEqual(start);expect(await input.evaluate(el=>el.selectionStart)).toBeLessThan(start+20);
 await input.press('Home');expect(await input.evaluate(el=>el.selectionStart)).toBe(start);
 const original=await input.inputValue(),parts=unzipSync(readFileSync(source));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
 await input.press('ControlOrMeta+Home');await page.keyboard.insertText('EDIT ');const edited=await save('edited'),changed=unzipSync(readFileSync(edited));
 for(const name of Object.keys(parts))if(name!=='word/document.xml')expect(changed[name],name).toEqual(parts[name]);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
 await reopenDocx(page,input,edited,'EDIT '+original);await expect(page.locator('#playground-error')).toBeEmpty();expect(errors).toEqual([]);
});

test('sizes an inserted image against its landscape section and restores the source on undo',async({page},info)=>{
 await page.goto('/playground.html');await showAllTools(page);await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Section 1 opening/);
 const original=await input.inputValue();await input.focus();await input.evaluate(el=>{const at=el.value.indexOf('Section 2 opening');el.setSelectionRange(at,at+'Section 2 opening'.length);el.dispatchEvent(new Event('select',{bubbles:true}));});
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2000;c.height=100;const x=c.getContext('2d');x.fillStyle='#2676aa';x.fillRect(0,0,c.width,c.height);return c.toDataURL().split(',')[1];});
 await page.getByLabel('Insert image file').setInputFiles({name:'wide.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect(input).toHaveValue(original.replace('Section 2 opening','\ufffc'));
 const save=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name+'.docx');await(await pending).saveAs(path);return path;};
 const edited=await save('image'),xml=new TextDecoder().decode(unzipSync(readFileSync(edited))['word/document.xml']);
 const extent=await page.evaluate(xml=>{const x=new DOMParser().parseFromString(xml,'application/xml');return x.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing','extent')[0].getAttribute('cx');},xml);
 expect(Number(extent)/9525).toBe(960);
 await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);expect(unzipSync(readFileSync(await save('image-undo')))).toEqual(unzipSync(readFileSync(source)));
 await reopenDocx(page,input,edited,original.replace('Section 2 opening','\ufffc'));await expect(page.locator('#playground-error')).toBeEmpty();
});

test('paints the retained document background on every differently sized page',async({page})=>{
 const parts=unzipSync(readFileSync(source));parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:body>','<w:background w:color="DDEEFF"/><w:body>'));
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles({name:'mixed-background.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(zipSync(parts))});
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^Section 1 opening/);await expect(page.locator('canvas.canvas-page')).toHaveCount(4);
 const colors=await page.locator('canvas.canvas-page').evaluateAll(cs=>cs.map(c=>Array.from(c.getContext('2d').getImageData(5,5,1,1).data)));
 expect(colors).toEqual(Array(4).fill([221,238,255,255]));
});
