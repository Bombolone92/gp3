import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {reopenDocx} from './helpers/reopen-docx.js';
const source='public/fixtures/bottom-line-boundary.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/bottom-line-boundary/reference.json'));

test('matches all native automatic, compressed, exact and minimum page boundaries',async({page})=>{
  test.setTimeout(120000);
  for(const [path,hash] of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const result=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
    const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');
    const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
    await checkFontAvailability('Arial');if(!fontAvailable('Arial'))return {missingFont:true};
    const pkg=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(pkg);
    const ctx=new OffscreenCanvas(1,1).getContext('2d');setCanvasFontAlternatives(ctx,pkg.styles.fontAlternatives);
    const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories,{styles:pkg.styles,drawingLayouts:pkg.drawingLayouts});
    const cases={};let current;
    for(const line of layout.lines){const text=line.fragments.map(f=>f.text||'').join(''),m=/^Case (\d+)/.exec(text);if(m){current=Number(m[1]);cases[current]={page:line.page};}if(text==='x')cases[current].textPage=line.page;}
    return {pageCount:layout.pageCount,cases};
  },[...readFileSync(source)]);
  test.skip(result.missingFont,'Native reference cutoff measurements require installed Arial.');
  expect(result.pageCount).toBe(reference.pageCount);
  expect(Object.keys(result.cases)).toHaveLength(reference.cases.length);
  for(const c of reference.cases){expect(result.cases[c.id].page,c.name).toBe(c.page);if(c.visible)expect(result.cases[c.id].textPage,c.name).toBe(c.textPage);}
});

for (const fixture of ['bottom-line-boundary','bottom-line-fresh']) test(`retains ${fixture} through editing, undo and reopening`,async({page},info)=>{
  const source=`public/fixtures/${fixture}.docx`;
  test.setTimeout(120000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/playground.html');await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input=page.getByRole('textbox',{name:'Document text'});await expect(input).toHaveValue(fixture==='bottom-line-boundary'?/^Case 01/:/^A/);await expect(input).not.toHaveAttribute('readonly','');
  const text=await input.inputValue(),pages=await page.locator('canvas.canvas-page').count();
  const capture=async()=>{await input.evaluate(e=>e.blur());await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return page.locator('canvas.canvas-page').evaluateAll(cs=>[cs[0],cs.at(-1)].map(c=>c.toDataURL()));};
  const pixels=await capture(),original=unzipSync(readFileSync(source));
  const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const path=info.outputPath(name);await(await pending).saveAs(path);return path;};
  const same=(path,edited=false)=>{const parts=unzipSync(readFileSync(path));expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());for(const name of Object.keys(original))if(!edited||name!=='word/document.xml')expect(Buffer.from(parts[name]).equals(Buffer.from(original[name])),name).toBe(true);};
  same(await download('noedit.docx'));await input.focus();await input.press('ControlOrMeta+End');await page.keyboard.insertText(' verified');
  const editedText=await input.inputValue(),edited=await download('edited.docx');same(edited,true);
  await input.press('ControlOrMeta+z');await expect(input).toHaveValue(text);same(await download('undo.docx'));expect(await capture()).toEqual(pixels);
  await reopenDocx(page,input,edited,editedText);await expect(page.locator('canvas.canvas-page')).toHaveCount(pages);expect(errors).toEqual([]);
});

test('matches native fresh-page lines whose automatic advance exceeds the writing area',async({page})=>{
  const source='public/fixtures/bottom-line-fresh.docx';
  const reference=JSON.parse(readFileSync('tests/fixtures/bottom-line-fresh/reference.json'));
  test.setTimeout(120000);
  for(const [path,hash] of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
  await page.goto('/playground.html');
  const result=await page.evaluate(async bytes=>{
    const {DocxPackage}=await import('/src/engine/docx.js');
    const {validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
    const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');
    const {layoutDocument}=await import('/src/engine/layout.js');const {pageGeometry}=await import('/src/engine/page-settings.js');
    await checkFontAvailability('Arial');if(!fontAvailable('Arial'))return {missingFont:true};
    const pkg=await DocxPackage.open(new Uint8Array(bytes));await validateCanvasLayout(pkg);
    const ctx=new OffscreenCanvas(1,1).getContext('2d');setCanvasFontAlternatives(ctx,pkg.styles.fontAlternatives);
    const layout=layoutDocument(pkg.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables,pkg.pageStories,{styles:pkg.styles,drawingLayouts:pkg.drawingLayouts});
    const pages=Array.from({length:layout.pageCount},()=> '');
    for(const line of layout.lines)pages[line.page]+=line.fragments.map(f=>f.text||'').join('');
    return {pages:pages.map(s=>s.trim())};
  },[...readFileSync(source)]);
  test.skip(result.missingFont,'Native reference cutoff measurements require installed Arial.');
  expect(result.pages).toEqual(reference.pages);
});
