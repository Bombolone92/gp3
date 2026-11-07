import {test, expect} from '@playwright/test';
import {readFileSync, writeFileSync} from 'node:fs';
for (const kind of ['homePlate','chevron']) {
  const reference=JSON.parse(readFileSync(`tests/fixtures/arrow-${kind}/reference.json`,'utf8'));
  test(`${kind} uses the native reference's adjusted text rectangle in wide and tall shapes`,async({page},info)=>{
    await page.goto('/playground.html');
    const actual=await page.evaluate(async kind=>{
      const {checkFontAvailability,fontAvailable}=await import('/src/engine/font-availability.js');
      await checkFontAvailability('Arial'); if(!fontAvailable('Arial')) return null;
      const {DocxPackage}=await import('/src/engine/docx.js');
      const {loadCanvasFonts}=await import('/src/engine/canvas-text.js');
      const {decodeShape}=await import('/src/engine/canvas-shapes.js');
      const pkg=await DocxPackage.open(new Uint8Array(await(await fetch(`/fixtures/arrow-${kind}.docx`)).arrayBuffer()));
      await loadCanvasFonts(pkg);
      const assets=Object.values(pkg.assets), result=[];
      for(const i of [0,3,4,5,6]){
        const old=OffscreenCanvasRenderingContext2D.prototype.fillText; let origin,decoded;
        OffscreenCanvasRenderingContext2D.prototype.fillText=function(text,x,y){
          if(text==='Text'){const m=this.getTransform();origin={x:(m.a*x+m.c*y+m.e)/2,y:(m.b*x+m.d*y+m.f)/2};}
          return old.call(this,text,x,y);
        };
        try {
          decoded=await decodeShape(assets[i],new Map());
          result.push({x:60+260*(i%2)+(origin.x+decoded.left)*.75,y:100+140*Math.floor(i/2)+(origin.y+decoded.top)*.75});
        } finally {OffscreenCanvasRenderingContext2D.prototype.fillText=old;decoded?.close();}
      }
      return result;
    },kind);
    test.skip(!actual,'Requires installed Arial for comparison with the native reference.');
    writeFileSync(info.outputPath('origins.json'),JSON.stringify({actual,native:reference.texts},null,2));
    expect(actual).toHaveLength(5);
    for(const [i,native] of reference.texts.entries()){
      expect(Math.abs(actual[i].x-native.x),`control ${i} x`).toBeLessThan(.2);
      expect(Math.abs(actual[i].y-native.y),`control ${i} y`).toBeLessThan(.2);
    }
  });
}
