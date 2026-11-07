import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/svg-backdrop-compositing/';
test('pending native SVG compositing over varied opaque backdrops',async({page},info)=>{
 const ref=JSON.parse(readFileSync(folder+'native-colors.json')),cases=JSON.parse(readFileSync(folder+'cases.json'));
 const svg=unzipSync(readFileSync(folder+'control.docx'))['word/media/vector.svg'];
 await page.goto('/playground.html');
 const colors=await page.evaluate(async({bytes,cases})=>{
  const {decodeSvg}=await import('/src/engine/svg-images.js');const image=await decodeSvg(new Uint8Array(bytes));
  try{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=900;const c=canvas.getContext('2d');c.drawImage(image,0,0,1200,900);
   return cases.map(({row,column})=>Array.from(c.getImageData(column*300+150,row*100+50,1,1).data).slice(0,3));
  }finally{image.close();}
 },{bytes:[...svg],cases});
 const differences=colors.flatMap((actual,i)=>actual.some((c,j)=>c!==ref.colors[i][j])?[{...cases[i],actual,native:ref.colors[i]}]:[]);
 writeFileSync(info.outputPath('differences.json'),JSON.stringify(differences,null,2));
 test.fail(true,'Existing byte-alpha correction differs from native metafile/GDI+ compositing in low-opacity dark-background and overlapping-fill cases; PDF raster colors are separate evidence.');
 expect(colors).toEqual(ref.colors);
});
