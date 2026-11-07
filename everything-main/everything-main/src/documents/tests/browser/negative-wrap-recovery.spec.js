import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { openReadOnlyPreview } from './helpers/preview.js';
const folder = 'tests/fixtures/negative-wrap-recovery/';
for (const scope of ['body','header','footer']) for (const zoom of [1,.75]) test(`${scope} at ${zoom}: negative-wrap recovery retains healthy content`, async ({page},info) => {
 test.setTimeout(180000); await page.goto('/playground.html');
 const result = await page.evaluate(async ({sources,zoom}) => {
  const {openCanvasDocument}=await import('/src/engine/open-document.js');
  const {CanvasEditor}=await import('/src/engine/canvas-editor.js');
  const out=[];
  for(const bytes of sources){
   const {pkg,images}=await openCanvasDocument(new Uint8Array(bytes));
   const host=document.createElement('div');document.body.append(host);const errors=[];
   const editor=new CanvasEditor(host,{...pkg,images,onError:e=>errors.push(e.message)});
   try{
    editor.setZoom(zoom);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    out.push({readOnly:!!pkg.readOnly,issues:pkg.previewIssues,images:images.size,tables:pkg.tables.length,errors,
     storyIssues:editor.storyLayout.unsupported,objects:editor.layout.floatingObjects.length+editor.storyLayout.floatingObjects.length,
     pixels:editor.canvases.map(c=>c.toDataURL()),
     geometry:[...editor.layout.lines,...editor.storyLayout.lines].map(l=>({page:l.page,y:l.y,baseline:l.baseline,height:l.height,fragments:l.fragments.map(f=>({text:f.text,x:f.x,width:f.width,image:f.image&&{width:f.image.width,height:f.image.height}}))}))});
   }finally{editor.destroy();host.remove();}
  }
  const [actual,control]=out;
  return {actual:{...actual,pixels:undefined,geometry:undefined},control:{...control,pixels:undefined,geometry:undefined},samePixels:JSON.stringify(actual.pixels)===JSON.stringify(control.pixels),sameGeometry:JSON.stringify(actual.geometry)===JSON.stringify(control.geometry)};
 },{sources:['unsupported','matched'].map(n=>[...readFileSync(folder+scope+'-'+n+'.docx')]),zoom});
 writeFileSync(info.outputPath('recovery.json'),JSON.stringify(result,null,2));
 expect(result.control.readOnly).toBe(false);expect(result.actual.readOnly).toBe(true);
 expect(result.actual.images).toBe(result.control.images);expect(result.actual.images).toBeGreaterThan(0);
 expect(result.actual.tables).toBe(1);expect(result.actual.objects).toBe(scope==='body'?3:6);expect(result.actual.errors).toEqual([]);
 expect(result.samePixels).toBe(true);expect(result.sameGeometry).toBe(true);
 const issues=scope==='body'?result.actual.issues:result.actual.storyIssues.map(i=>i.message);
 expect(issues.filter(s=>s.includes('without text wrapping'))).toHaveLength(2);
 await openReadOnlyPreview(page,folder+scope+'-unsupported.docx');
 const input=page.getByRole('textbox',{name:'Document text'}),before=await input.inputValue();
 await input.focus();await input.press('ControlOrMeta+End');await input.press('x');expect(await input.inputValue()).toBe(before);
 await page.locator('.canvas-message summary').click();
 await expect(page.getByText(/without text wrapping/).first()).toBeVisible();
 await page.screenshot({path:info.outputPath('preview.png'),fullPage:true});
});
