import { build } from "vite";
import { writeFileSync } from "node:fs";
const baseline=process.argv[2]==="baseline";
const r=await build({configFile:false,logLevel:"silent",build:{write:false,lib:{entry:baseline?"tmp/wcag-minimap-before-native-entry.js":"tmp/wcag-minimap-native-entry.js",name:"MinimapFixture",formats:["iife"]}}});
const output=(Array.isArray(r)?r[0]:r).output;
const code=output.find(x=>x.type==="chunk"&&x.isEntry).code;
const css=output.filter(x=>x.type==="asset"&&x.fileName.endsWith(".css")).map(x=>String(x.source)).join("\n");
const probe='.minimap{--minimap-bottom:78px;bottom:min(var(--minimap-bottom),40%);max-height:calc(100% - min(var(--minimap-bottom),40%) - 12px);overflow:auto}@media(max-width:760px){.minimap{--minimap-bottom:138px}}@media(max-width:460px){.minimap{--minimap-bottom:180px}}';
for(const version of (baseline?["before","probe"]:["final"])){
 const html='<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Minimap français sombre espacement</title><style>'+css+'\n*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}.canvas-wrap{height:calc(100vh - 91px);margin-top:91px}.canvas-wrap>[data-action=minimap]{position:absolute;top:4px;left:4px}'+(version==="probe"?probe:"")+'</style><body><div class="canvas-wrap"><canvas id="canvas" tabindex="0" aria-label="Canevas"></canvas><button type="button" data-action="minimap">Minicarte</button><section id="minimap" class="minimap panel"></section></div><script>'+code.replace(/<\/script/gi,"<\\/script")+'</script></body></html>';
 writeFileSync('tmp/wcag-minimap-'+version+'-fr-dark-spacing-native.html',html);
 for(const height of [300,400])writeFileSync('tmp/wcag-minimap-'+version+'-fr-dark-spacing-320-'+height+'.html','<!doctype html><html lang="fr"><meta charset="utf-8"><title>Minimap '+version+' français '+height+'</title><iframe style="width:320px;height:'+height+'px;border:0" title="Minimap français sombre avec espacement" src="wcag-minimap-'+version+'-fr-dark-spacing-native.html"></iframe><p id="metrics"></p><script>addEventListener("message",e=>{if(e.origin===location.origin&&e.data?.audit==="minimap")document.querySelector("#metrics").textContent=e.data.description})</script></html>');
}
