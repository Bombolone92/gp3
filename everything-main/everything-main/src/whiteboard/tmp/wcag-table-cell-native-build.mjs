import {build} from 'vite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
for(const version of ['before','final']){
 const entry='tmp/wcag-table-cell-native-'+version+'-entry.js';
 const source=readFileSync('tmp/wcag-table-cell-native-entry.js','utf8');
 writeFileSync(entry,version==='final'?source.replace('./wcag-table-cell-before-style.css','../src/style.css'):source);
 const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry,name:'TableCellFixture',formats:['es']}}});
 const output=(Array.isArray(result)?result[0]:result).output;
 for(const asset of output){const path='tmp/'+asset.fileName;mkdirSync(dirname(path),{recursive:true});writeFileSync(path,asset.type==='chunk'?asset.code:asset.source);}
 const code=output.find(x=>x.type==='chunk'&&x.isEntry).code;
 const css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n');
 const spacing='*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}';
 const file='wcag-table-cell-fr-'+version+'.html';
 writeFileSync('tmp/'+file,'<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual French table field '+version+'</title><style>'+css+'\n'+spacing+'</style><body><main class="editor"><header style="height:91px;min-height:91px;flex-shrink:0"></header><div class="canvas-wrap"><canvas id="canvas" tabindex="0" aria-label="Local fixture canvas"></canvas></div></main><button id="open" type="button" style="position:absolute;top:0;left:0">Open table cells</button><script type="module">'+code.replace(/<\/script/gi,'<\\/script')+'</script></body></html>');
 writeFileSync('tmp/wcag-table-cell-fr-'+version+'-300.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>French table field '+version+'</title><iframe title="Actual French table editor component" style="width:320px;height:300px;border:0" src="'+file+'"></iframe><p id="metrics"></p><script>addEventListener("message",e=>{if(e.origin===location.origin&&e.data?.audit==="table-cell-fr")document.getElementById("metrics").textContent=e.data.description;});</script></html>');
}
