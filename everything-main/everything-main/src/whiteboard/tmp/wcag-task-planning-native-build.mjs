import { build } from 'vite';
import { writeFileSync } from 'node:fs';
const result = await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'tmp/wcag-task-planning-native-entry.js',name:'TaskPlanningFixture',formats:['iife']}}});
const output = (Array.isArray(result) ? result[0] : result).output;
const code=output.find(part=>part.type==='chunk'&&part.isEntry).code;
const css=output.filter(part=>part.type==='asset'&&part.fileName.endsWith('.css')).map(part=>String(part.source)).join('\n');
for (const spacing of [false,true]) {
 const overrides=spacing?'* {line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important} p {margin-bottom:2em !important}':'';
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local Tasks layout fixture</title><style>${css}\n${overrides}</style></head><body><button id="open" type="button">Tasks</button><script>${code.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
 const name=spacing?'task-planning-spacing':'task-planning';
 writeFileSync(`tmp/wcag-${name}-native.html`,html);
 writeFileSync(`tmp/wcag-${name}-320.html`,`<!doctype html><meta charset="utf-8"><title>320 by 400 Tasks fixture</title><iframe title="Tasks at 320 by 400 CSS pixels" style="width:320px;height:400px;border:0" src="wcag-${name}-native.html"></iframe>`);
 console.log(name,html.length,'bytes');
 for(const lang of ['en','fr']) for(const theme of ['light','dark']) writeFileSync(`tmp/wcag-${name}-current-${lang}-${theme}-320.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><title>Current Tasks ${lang} ${theme}</title><iframe title="Tasks at 320 by 400 CSS pixels" style="width:320px;height:400px;border:0" src="wcag-${name}-native.html?lang=${lang}&theme=${theme}"></iframe><p id="metrics"></p><script>addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.audit==='task-planning')document.querySelector('#metrics').textContent=event.data.description;});</script></html>`);
}
