import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
const reference=JSON.parse(readFileSync('tests/fixtures/triangle-shapes/reference.json','utf8'));
test('places text inside both native triangle text rectangles',async({page},info)=>{
 await page.goto('/playground.html');
 const actual=await page.evaluate(async()=>{
  const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');
  await checkFontAvailability('Arial');if(!fontAvailable('Arial'))return null;
  const {DocxPackage}=await import('/src/engine/docx.js');
  const {loadCanvasFonts}=await import('/src/engine/canvas-text.js');
  const {decodeShape}=await import('/src/engine/canvas-shapes.js');
  const pkg=await DocxPackage.open(new Uint8Array(await(await fetch('/fixtures/triangle-shapes.docx')).arrayBuffer()));
  await loadCanvasFonts(pkg);
  const assets=Object.values(pkg.assets),result=[];
  for(const i of [0,1,6]){
   const old=OffscreenCanvasRenderingContext2D.prototype.fillText;let origin,decoded;
   OffscreenCanvasRenderingContext2D.prototype.fillText=function(text,x,y){
    if(text==='Inset text'){const m=this.getTransform();origin={x:(m.a*x+m.c*y+m.e)/2,y:(m.b*x+m.d*y+m.f)/2};}
    return old.call(this,text,x,y);
   };
   try{decoded=await decodeShape(assets[i],new Map());result.push({x:60+260*(i%2)+(origin.x+decoded.left)*.75,y:100+140*Math.floor(i/2)+(origin.y+decoded.top)*.75});}
   finally{OffscreenCanvasRenderingContext2D.prototype.fillText=old;decoded?.close();}
  }
  return result;
 });
 test.skip(!actual,'Native text reference requires installed Arial.');
 writeFileSync(info.outputPath('text-origins.json'),JSON.stringify({actual,native:reference.texts},null,2));
 expect(actual).toHaveLength(reference.texts.length);
 for(const [i,native] of reference.texts.entries()){
  expect(Math.abs(actual[i].x-native.x),'text x '+i).toBeLessThan(.2);
  // The native reference's right-triangle baseline differs by 0.229pt; retain that
  // measured subpixel limit explicitly, without shifting geometry to hide it.
  expect(Math.abs(actual[i].y-(792-native.y)),'text baseline '+i).toBeLessThan(.3);
 }
});
