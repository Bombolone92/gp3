import {build} from 'vite';
import {writeFileSync} from 'node:fs';
const version=process.argv[2]||'before';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'tmp/wcag-task-resize-native-entry.js',name:'TaskResizeFixture',formats:['iife']}}});
const output=(Array.isArray(result)?result[0]:result).output;
const code=output.find(x=>x.type==='chunk'&&x.isEntry).code;
const css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n');
for(const spacing of [false,true]){
 const kind=spacing?'spacing':'normal';
 const override=spacing?'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}':'';
 const file='wcag-task-resize-'+version+'-'+kind+'.html';
 writeFileSync('tmp/'+file,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual Timeline preview resize '+version+'</title><style>'+css+'\n'+override+'</style><body><button id="open">Tasks</button><script>'+code.replace(/<\/script/gi,"<\\/script")+'</script></body></html>');
 for(const [lang,theme] of [['en','light'],['fr','dark']]){
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>Timeline resize '+version+' '+lang+' '+theme+'</title><iframe id="subject" title="Actual Tasks component" style="width:320px;height:400px;border:0" src="'+file+'?lang='+lang+'&theme='+theme+'"></iframe><p><button id="grow" type="button">Resize viewport taller</button><button id="restore" type="button">Restore viewport</button></p><p id="metrics"></p><script>for(const [id,height] of [["grow","500px"],["restore","400px"]]){const button=document.getElementById(id);button.addEventListener("mousedown",e=>e.preventDefault());button.onclick=()=>document.getElementById("subject").style.height=height;}addEventListener("message",e=>{if(e.origin===location.origin&&e.data?.audit==="task-planning")document.getElementById("metrics").textContent=e.data.description;});</script></html>';
  writeFileSync('tmp/wcag-task-resize-'+version+'-'+kind+'-'+lang+'-'+theme+'-320.html',html);
 }
}
