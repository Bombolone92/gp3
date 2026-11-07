import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';

test('renders native outlined text in tables and preserves outlines across editing',async({page},info)=>{
 const source='public/fixtures/text-outline-control.docx',bytes=readFileSync(source),ref=JSON.parse(readFileSync('tests/fixtures/text-outline-control/reference.json'));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync('tests/fixtures/text-outline-control/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const old=CanvasRenderingContext2D.prototype.strokeText;window.outlinePaint=[];CanvasRenderingContext2D.prototype.strokeText=function(text,x,y,...args){const t=this.getTransform();window.outlinePaint.push({text,color:this.strokeStyle,width:this.lineWidth*Math.hypot(t.a,t.b)/devicePixelRatio,join:this.lineJoin});return old.call(this,text,x,y,...args);};});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
 const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(/^Ordinary text control/);await expect(input).not.toHaveAttribute('readonly');await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
 const actual=await page.evaluate(async b=>{
  const {DocxPackage}=await import('/src/engine/docx.js'),{TextDocument}=await import('/src/engine/model.js'),{loadCanvasFonts,measureCanvasText}=await import('/src/engine/canvas-text.js'),{layoutDocument}=await import('/src/engine/layout.js'),{pageGeometry}=await import('/src/engine/page-settings.js');
  const p=await DocxPackage.open(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));await loadCanvasFonts(p);const ctx=document.createElement('canvas').getContext('2d'),m=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  return layoutDocument(m.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(m.pageSettings),m.numbering,m.tables).lines.filter(l=>l.fragments.some(f=>f.text)).map(l=>({text:l.fragments.map(f=>f.text).join(''),x:l.fragments[0].x*.75,y:l.baseline*.75}));
 },bytes.toString('base64'));
 for(const line of actual){const native=ref.pages[0].find(n=>n.text.includes(line.text));expect(native,line.text).toBeTruthy();expect(Math.abs(line.y-native.baseline),line.text).toBeLessThan(.3);if (!['Left card','Right card'].includes(line.text)) expect(Math.abs(line.x-native.glyphs[native.text.indexOf(line.text)]),line.text).toBeLessThan(.3); // Default table horizontal inset is independently unresolved; see fixture README.
 }
 const paint=await page.evaluate(()=>window.outlinePaint);for(const text of ['Direct outlined text','Inherited outlined text','Direct color plus outline','Left card','Right card'])expect(paint.some(p=>p.text===text&&p.color==='#008080'&&Math.abs(p.width-1)<1e-6&&p.join==='bevel')).toBe(true);
 const png=await page.locator('canvas.canvas-page').evaluate(c=>c.toDataURL());writeFileSync(info.outputPath('page.png'),Buffer.from(png.split(',')[1],'base64'));
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
 const parts=unzipSync(bytes),check=(path,edit=false)=>{const out=unzipSync(readFileSync(path));expect(Object.keys(out)).toEqual(Object.keys(parts));for(const n in parts)if(!edit||n!=='word/document.xml')expect(out[n],n).toEqual(parts[n]);};
 check(await download('noedit.docx'));const original=await input.inputValue();await input.focus();await input.press('ControlOrMeta+Home');await page.keyboard.insertText('Test ');await expect(input).toHaveValue('Test '+original);const edited=await download('edited.docx');check(edited,true);await input.press('ControlOrMeta+z');await expect(input).toHaveValue(original);check(await download('undo.docx'));
 page.once('dialog',d=>d.accept());await page.getByLabel('Open DOCX file').setInputFiles(edited);await expect(input).toHaveValue('Test '+original);expect(errors).toEqual([]);
});


test('clips an outline to its run inside a shared kerning group',async({page})=>{
 const {zipSync,strFromU8,strToU8}=await import('fflate');
 const parts=unzipSync(readFileSync('public/fixtures/text-outline-control.docx'));
 const xml=strFromU8(parts['word/document.xml']);
 const original='<w:r><w:rPr></w:rPr><w:t>Ordinary text control</w:t></w:r>';
 expect(xml).toContain(original);
 parts['word/document.xml']=strToU8(xml.replace(original,'<w:r><w:t>A</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Outlined"/><w:color w:val="000000"/></w:rPr><w:t>V</w:t></w:r><w:r><w:t>AV</w:t></w:r>'));
 await page.addInitScript(()=>{window.mixedOutlinePaint=[];const p=CanvasRenderingContext2D.prototype,rect=p.rect,stroke=p.strokeText;p.rect=function(...args){this.lastOutlineRect=args;return rect.apply(this,args);};p.strokeText=function(text,...args){if(text==='AVAV')window.mixedOutlinePaint.push({text,color:this.strokeStyle,rect:this.lastOutlineRect});return stroke.call(this,text,...args);};});
 await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles({name:'mixed-outline.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from(zipSync(parts))});
 await expect(page.getByRole('textbox',{name:'Document text'})).toHaveValue(/^AVAV/);
 await expect.poll(()=>page.evaluate(()=>window.mixedOutlinePaint.length)).toBeGreaterThan(0);
 const paint=await page.evaluate(()=>window.mixedOutlinePaint);for(const stroke of paint){expect(stroke.color).toBe('#008080');expect(stroke.rect[0]).toBeGreaterThan(96);expect(stroke.rect[2]).toBeGreaterThan(5);expect(stroke.rect[2]).toBeLessThan(30);}
});
