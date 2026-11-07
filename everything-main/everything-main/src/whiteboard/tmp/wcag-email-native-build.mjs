import {build} from "vite";
import {writeFileSync} from "node:fs";
const result=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{entry:"tmp/wcag-email-native-entry.js",name:"EmailAssistanceFixture",formats:["es"]}}});
const output=(Array.isArray(result)?result[0]:result).output;
const code=output.find(x=>x.type==="chunk"&&x.isEntry).code;
const css=output.filter(x=>x.type==="asset"&&x.fileName.endsWith(".css")).map(x=>String(x.source)).join("\n");
for(const spacing of [false,true]){
 const kind=spacing?"spacing":"normal";
 const override=spacing?'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}':'';
 const file='wcag-email-native-'+kind+'.html';
 writeFileSync('tmp/'+file,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local actual email verification form</title><style>'+css+'\n'+override+'</style><body><button id="open" type="button">Verify email</button><p id="status" role="status"></p><p id="state"></p><script type="module">'+code.replace(/<\/script/gi,"<\\/script")+'</script></body></html>');
 for(const lang of ["en","fr"])writeFileSync('tmp/wcag-email-'+kind+'-'+lang+'-320.html','<!doctype html><html lang="en"><meta charset="utf-8"><title>Local email verification '+lang+' '+kind+'</title><iframe title="Actual organization verification component" style="width:320px;height:400px;border:0" src="'+file+'?lang='+lang+'"></iframe><p id="metrics"></p><script>addEventListener("message",e=>{if(e.origin===location.origin&&e.data?.audit==="email-assistance")document.getElementById("metrics").textContent=e.data.description;});</script></html>');
}
