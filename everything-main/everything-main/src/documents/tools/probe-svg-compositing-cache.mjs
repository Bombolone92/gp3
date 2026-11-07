import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const [candidateDir,output]=process.argv.slice(2);
if(!candidateDir||!output)throw Error('Usage: node tools/probe-svg-compositing-cache.mjs CANDIDATE_DIR OUTPUT_JSON');
const dir=candidateDir.replaceAll('\\','/').replace(/\/?$/,'/');
const fixtures=['svg-backdrop-compositing','svg-external-backdrop'].map(name=>({name,svg:[...unzipSync(readFileSync(`tests/fixtures/${name}/control.docx`))['word/media/vector.svg']],ref:JSON.parse(readFileSync(`tests/fixtures/${name}/native-colors.json`,'utf8').replace(/^\uFEFF/,'')),cases:JSON.parse(readFileSync(`tests/fixtures/${name}/cases.json`,'utf8'))}));
const modules=['svg-native-compositing.js','svg-native-groups.js','svg-native-strokes.js','svg-native-opacity.js','svg-group-opacity.js','svg-images.js','paint-image.js'];
const browser=await chromium.launch({channel:'chrome',headless:true}),results={
 candidateHashes:Object.fromEntries(modules.map(name=>[name,sha(readFileSync(dir+name))])),
 baselineHashes:Object.fromEntries(modules.filter(name=>name!=='svg-native-compositing.js').map(name=>[name,sha(readFileSync('src/engine/'+name))])),
 fixtureHashes:Object.fromEntries(fixtures.map(({name})=>[name,Object.fromEntries(['control.docx','cases.json','native-colors.json'].map(file=>[file,sha(readFileSync(`tests/fixtures/${name}/${file}`))]))])),
};
try{
 for(const mode of ['baseline','candidate']){
  const context=await browser.newContext(),page=await context.newPage();
  if(mode==='candidate')for(const name of ['svg-native-compositing.js','svg-native-groups.js','svg-native-strokes.js','svg-native-opacity.js','svg-group-opacity.js','svg-images.js','paint-image.js'])await page.route(new RegExp('/src/engine/'+name.replaceAll('.','\\.')+'(?:\\?.*)?$'),r=>r.fulfill({contentType:'text/javascript',body:readFileSync(dir+name,'utf8')}));
  await page.goto('http://127.0.0.1:5173/playground.html');
  results[mode]=await page.evaluate(async ({fixtures,candidate})=>{
   const {decodeSvg}=await import('/src/engine/svg-images.js'),{paintImage}=await import('/src/engine/paint-image.js');
   const stats=candidate?(await import('/src/engine/svg-native-compositing.js')).compositingStats:null;
   const results={controls:[]};
   for(const {name,svg,ref,cases} of fixtures){
    const image=await decodeSvg(new Uint8Array(svg)),canvas=new OffscreenCanvas(1200,900),c=canvas.getContext('2d');
    const paints=ref.samples||[{background:'FFFFFF',colors:ref.colors}];
    const diffs=[];
    for(const sample of paints){c.clearRect(0,0,1200,900);c.fillStyle='#'+sample.background;c.fillRect(0,0,1200,900);paintImage(c,image,0,0,1200,900);
     const colors=sample.colors.map((_,i)=>{const x=ref.samples?600:cases[i].column*300+150,y=ref.samples?i*100+50:cases[i].row*100+50;return [...c.getImageData(x,y,1,1).data].slice(0,3);});
     colors.forEach((actual,i)=>{if(actual.some((v,j)=>v!==sample.colors[i][j]))diffs.push({background:sample.background,i,actual,native:sample.colors[i]});});
    }
    results.controls.push({name,diffs,retained:stats?.()});image.close();results.controls.at(-1).afterClose=stats?.();
   }
   const image=await decodeSvg(new Uint8Array(fixtures[0].svg)),c=new OffscreenCanvas(816,1056).getContext('2d');
   function paint(){c.fillStyle='white';c.fillRect(0,0,816,1056);for(let i=0;i<10;i++)paintImage(c,image,50+(i%2)*350,50+Math.floor(i/2)*180,300,170);c.getImageData(0,0,1,1);}
   let t=performance.now();paint();results.cold=performance.now()-t;
   for(let i=0;i<4;i++)paint();results.timings=[];
   for(let i=0;i<24;i++){t=performance.now();for(let j=0;j<10;j++)paint();results.timings.push((performance.now()-t)/10);}
   results.retained=stats?.();image.close();results.afterClose=stats?.();return results;
  },{fixtures,candidate:mode==='candidate'});
  await context.close();console.log(mode,JSON.stringify(results[mode]));
 }
}finally{await browser.close();}
writeFileSync(output,JSON.stringify(results,null,2)+'\n');
