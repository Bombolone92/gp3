import {build} from 'vite';
import {writeFileSync} from 'node:fs';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'tmp/wcag-live-embed-native-entry.js',name:'LiveCaptionFixture',formats:['iife']}}});
const output=(Array.isArray(result)?result[0]:result).output,code=output.find(p=>p.type==='chunk'&&p.isEntry).code,css=output.filter(p=>p.type==='asset'&&p.fileName.endsWith('.css')).map(p=>String(p.source)).join('\n');
if(/url\((?!["']?data:)[^)]*\.woff/.test(css))throw Error('Font asset was not embedded.');
for(const spacing of [false,true]){
 const name=spacing?'live-embed-spacing':'live-embed',overrides=spacing?'* {line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important} p {margin-bottom:2em !important}':'';
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local live-caption layout fixture</title><style>${css}\n${overrides}</style><body><p>Local caption fixture: external player navigation is suppressed. This does not assess provider media.</p><button id="fixture-open" type="button">Open live</button><p id="fixture-status" role="status"></p><div class="canvas-wrap" style="position:relative;width:100%;height:280px"><canvas id="canvas" tabindex="0" style="width:100%;height:280px"></canvas></div><script>${code.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
 writeFileSync(`tmp/wcag-${name}-native.html`,html);
 for(const lang of ['en','fr'])for(const theme of ['light','dark'])writeFileSync(`tmp/wcag-${name}-${lang}-${theme}-320.html`,`<!doctype html><meta charset="utf-8"><title>320 by 400 local live-caption fixture</title><iframe title="Local live-caption controls at 320 by 400 CSS pixels" style="width:320px;height:400px;border:0" src="wcag-${name}-native.html?lang=${lang}&theme=${theme}"></iframe>`);
 console.log(name,html.length,'bytes; actual component/style/font bundle');
}
