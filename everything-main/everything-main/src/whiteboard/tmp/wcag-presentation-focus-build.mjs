import {build} from 'vite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
for(const version of ['before','final']){
 const entry='tmp/wcag-presentation-focus-'+version+'-entry.js';
 const source=readFileSync('tmp/wcag-presentation-focus-entry.js','utf8');
 writeFileSync(entry,version==='final'?source.replace('./wcag-presentation-before-style.css','../src/style.css'):source);
 const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry,name:'PresentationFocusFixture',formats:['es']}}});
 const output=(Array.isArray(result)?result[0]:result).output;
 for(const asset of output){const path='tmp/'+asset.fileName;mkdirSync(dirname(path),{recursive:true});writeFileSync(path,asset.type==='chunk'?asset.code:asset.source);}
 const code=output.find(x=>x.type==='chunk'&&x.isEntry).code;
 const css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n');
 for(const spacing of [false,true]){
  const kind=spacing?'spacing':'normal',file='wcag-presentation-focus-'+version+'-'+kind+'.html';
  const extra=spacing?'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}':'';
  writeFileSync('tmp/'+file,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual presentation '+version+'</title><style>'+css+'\n'+extra+'</style><body><button style="position:absolute;top:0;left:0" id="open" type="button">Open presentation</button><p id="status" role="status"></p><script type="module">'+code.replace(/<\/script/gi,'<\\/script')+'</script></body></html>');
  for(const lang of ['en','fr'])writeFileSync('tmp/wcag-presentation-'+version+'-'+kind+'-'+lang+'-320.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>Presentation '+version+' '+lang+' '+kind+'</title><iframe title="Actual presentation component" style="width:320px;height:400px;border:0" src="'+file+'?lang='+lang+'"></iframe>');
 }
}
