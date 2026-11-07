import {build} from 'vite';
import {writeFileSync} from 'node:fs';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'tmp/wcag-ai-review-native-entry.js',name:'AIReviewFixture',formats:['iife']}}});
const output=(Array.isArray(result)?result[0]:result).output,code=output.find(p=>p.type==='chunk'&&p.isEntry).code,css=output.filter(p=>p.type==='asset'&&p.fileName.endsWith('.css')).map(p=>String(p.source)).join('\n');
if(/url\((?!["']?data:)[^)]*\.woff/.test(css))throw Error('Font asset was not embedded.');
for(const spacing of [false,true]){
 const name=spacing?'ai-review-spacing':'ai-review',overrides=spacing?'* {line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important} p {margin-bottom:2em !important}':'';
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local AI review layout fixture</title><style>${css}\n${overrides}</style><body><p>Local fixture: all content and AI responses stay in this page.</p><button id="fixture-open" type="button">Open review</button><p id="fixture-status" role="status"></p><script>${code.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
 writeFileSync(`tmp/wcag-${name}-native.html`,html);
 for(const mode of ['summary','notes','themes','named'])writeFileSync(`tmp/wcag-${name}-${mode}-320.html`,`<!doctype html><meta charset="utf-8"><title>320 by 400 AI ${mode} review fixture</title><iframe title="AI ${mode} review at 320 by 400 CSS pixels" style="width:320px;height:400px;border:0" src="wcag-${name}-native.html?mode=${mode}"></iframe>`);
 console.log(name,html.length,'bytes; actual component/style/font bundle');
}
