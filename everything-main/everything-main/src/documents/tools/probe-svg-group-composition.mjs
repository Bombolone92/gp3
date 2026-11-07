import {chromium} from '@playwright/test';
import {unzipSync} from 'fflate';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=['svg-group-composition','svg-group-raster','svg-group-transforms','svg-group-rectangle-edges'].map(name=>({name,xml:new TextDecoder().decode(unzipSync(readFileSync(`${root}/public/fixtures/${name}.docx`))['word/media/vector.svg'])}));
const browser=await chromium.launch({channel:'msedge',headless:true});
const rows=[];
try{
 for(const baseline of [true,false,false,true]){
  const page=await browser.newPage();
  if(baseline)await page.route('**/src/engine/svg-native-groups.js*',route=>route.fulfill({contentType:'text/javascript',body:execFileSync('git',['show','e22ced0f:src/engine/svg-native-groups.js'],{cwd:root,encoding:'utf8'})}));
  await page.goto(process.argv[2]||'http://127.0.0.1:5173/playground.html');
  rows.push({baseline,results:await page.evaluate(async source=>{
   const {nativeSvgStrokes}=await import('/src/engine/svg-native-strokes.js');
   return source.map(({name,xml})=>{
    const root=new DOMParser().parseFromString(xml,'image/svg+xml').documentElement;
    const size={width:+root.getAttribute('width'),height:+root.getAttribute('height')};
    const samples=[];for(let i=0;i<90;i++){const start=performance.now();nativeSvgStrokes(root,size,true);if(i>=60)samples.push(performance.now()-start);}
    return {name,samples};
   });
  },source)});
  await page.close();
 }
 console.log(JSON.stringify(rows,null,2));
}finally{await browser.close();}
