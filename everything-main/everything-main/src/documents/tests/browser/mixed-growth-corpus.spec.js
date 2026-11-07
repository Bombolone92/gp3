import{test,expect}from'@playwright/test';
import{existsSync,readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{join}from'node:path';
const ref=JSON.parse(readFileSync('tests/fixtures/mixed-growth-preference/corpus-reference.json'));
const source=join(process.env.DOCX_CORPUS_ROOT||'<corpus>',ref.source);
test('local business-plan mixed growth retains native monthly column origins',async({page},info)=>{
 test.skip(!existsSync(source),'Original user corpus stays local; set DOCX_CORPUS_ROOT to review it.');test.setTimeout(180000);
 const bytes=readFileSync(source);expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
 await page.goto('/playground.html');
 const result=await page.evaluate(async({base64,index})=>{
  const{DocxPackage}=await import('/src/engine/docx.js');const{layoutDocument}=await import('/src/engine/layout.js');const{pageGeometry}=await import('/src/engine/page-settings.js');const{validateCanvasLayout,measureCanvasText,setCanvasFontAlternatives}=await import('/src/engine/canvas-text.js');
  const d=await DocxPackage.open(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));await validateCanvasLayout(d);
  const ctx=document.createElement('canvas').getContext('2d');setCanvasFontAlternatives(ctx,d.styles.fontAlternatives);
  const l=layoutDocument(d.paragraphs,(t,s)=>measureCanvasText(ctx,t,s),pageGeometry(d.pageSettings),d.numbering,d.tables,d.pageStories,{styles:d.styles,drawingLayouts:d.drawingLayouts});
  return{pages:Math.max(...l.lines.map(r=>r.page))+1,points:l.lines.filter(r=>r.page===index).flatMap(r=>r.fragments.filter(f=>f.text?.trim()).map(f=>({text:f.text.trim(),x:f.x*.75,y:r.baseline*.75})))};
 },{base64:bytes.toString('base64'),index:ref.pageIndex});
 expect(result.pages).toBe(ref.totalPages);const used=new Set(),comparison=[];
 for(const n of ref.points){
  const candidates=result.points.map((p,i)=>({...p,i})).filter(p=>p.text===n.text&&!used.has(p.i)).sort((a,b)=>Math.abs(a.y-n.y)-Math.abs(b.y-n.y));
  expect(candidates.length,n.text).toBeGreaterThan(0);const a=candidates[0];used.add(a.i);comparison.push({native:n,actual:a,dx:a.x-n.x,dy:a.y-n.y});
 }
 writeFileSync(info.outputPath('native-origins.json'),JSON.stringify(comparison,null,2));
 for(const c of comparison)for(const key of ['dx','dy'])expect(Math.abs(c[key]),`${c.native.text} y=${c.native.y} ${key}`).toBeLessThan(ref.tolerancePt);
});
