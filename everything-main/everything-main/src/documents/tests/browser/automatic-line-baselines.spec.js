import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {showAllTools} from './helpers/editor-tools.js';
import {reopenDocx} from './helpers/reopen-docx.js';
const fixture='public/fixtures/automatic-line-baselines.docx';
const reference=JSON.parse(readFileSync('tests/fixtures/automatic-line-baselines/positions.json','utf8'));
const paint=page=>page.evaluate(()=>[...document.querySelectorAll('canvas.canvas-page')].flatMap((canvas,page)=>[...(window.baselinePaint.get(canvas)||new Map())].map(([text,origin])=>({page,text,y:origin.y*parseFloat(canvas.style.height)/origin.height*.75}))));
function matches(actual,expected) {
 for(const w of expected) {const a=actual.find(a=>a.page===w.page&&a.text===w.text);expect(a,JSON.stringify(w)).toBeDefined();expect(Math.abs(a.y-w.y),JSON.stringify({actual:a,word:w})).toBeLessThan(.2);}
}
test('paints automatic baselines like the native reference and preserves UI spacing edits through save, undo and reopen',async({page},info)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.baselinePaint=new Map();const original=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
   if(this.canvas.classList.contains('canvas-page')&&['Lead','Alpha','Beta','After'].includes(text)){
    // Text can paint in a translated, enlarged em square. Compare its actual
    // backing-store origin, then convert to page CSS pixels after painting.
    const m=this.getTransform();
    if(!window.baselinePaint.has(this.canvas))window.baselinePaint.set(this.canvas,new Map());
    window.baselinePaint.get(this.canvas).set(text,{y:m.b*x+m.d*y+m.f,height:this.canvas.height});
   }
   return original.call(this,text,x,y,...rest);
  };
 });
 await page.goto('/playground.html');
 const referenceFontsInstalled=await page.evaluate(async()=>{
  const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');
  const fonts=['Century Schoolbook','Century Gothic'];await Promise.all(fonts.map(checkFontAvailability));
  return fonts.every(fontAvailable);
 });
 test.skip(!referenceFontsInstalled,'Native baseline reference requires the original installed Century Schoolbook and Century Gothic fonts.');
 await showAllTools(page);
 await page.getByLabel('Open DOCX file').setInputFiles(fixture);
 const input=page.getByRole('textbox',{name:'Document text'});
 await expect(input).toHaveValue(/^Lead/);await expect(input).toHaveJSProperty('readOnly',false);
 await expect(page.locator('canvas.canvas-page')).toHaveCount(12);
 matches(await paint(page),reference);
 const text=await input.inputValue();
 await input.evaluate(el=>{const at=el.value.indexOf('Alpha');el.setSelectionRange(at,at);el.dispatchEvent(new Event('select',{bubbles:true}));});
 await page.getByRole('button',{name:'Line spacing options',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Line spacing',exact:true});
 await dialog.getByRole('combobox',{name:'Line spacing rule'}).selectOption('auto');
 await dialog.getByRole('spinbutton',{name:'Line spacing amount'}).fill('2');
 await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 matches(await paint(page),reference.filter(p=>p.page===5).map(p=>({...p,page:0})));
 const download=async name=>{const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download .docx',exact:true}).click();const file=info.outputPath(name);await(await pending).saveAs(file);return file;};
 const saved=await download('automatic-line-baselines.docx');
 const source=unzipSync(readFileSync(fixture)),edited=unzipSync(readFileSync(saved));
 expect(Object.keys(edited).sort()).toEqual(Object.keys(source).sort());
 for(const name of Object.keys(source))if(name!=='word/document.xml')expect(Buffer.from(edited[name]).equals(Buffer.from(source[name])),name).toBe(true);
 await input.press('ControlOrMeta+z');matches(await paint(page),reference);
 const undo=unzipSync(readFileSync(await download('automatic-line-baselines-undo.docx')));
 for(const name of Object.keys(source))expect(Buffer.from(undo[name]).equals(Buffer.from(source[name])),name).toBe(true);
 await reopenDocx(page,input,saved,text);
 matches(await paint(page),reference.filter(p=>p.page===5).map(p=>({...p,page:0})));
 expect(errors).toEqual([]);
});
