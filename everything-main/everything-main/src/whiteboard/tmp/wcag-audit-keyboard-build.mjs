import {build} from 'vite';
import {writeFileSync} from 'node:fs';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'tmp/wcag-audit-keyboard-entry.js',name:'AuditKeyboardFixture',formats:['iife']}}});
const out=(Array.isArray(result)?result[0]:result).output,code=out.find(p=>p.type==='chunk'&&p.isEntry).code,css=out.filter(p=>p.type==='asset'&&p.fileName.endsWith('.css')).map(p=>String(p.source)).join('\n');
const phase=process.argv[2]||'before';
for(const spacing of [false,true]){
 const name=`wcag-audit-keyboard-${phase}${spacing?'-spacing':''}`;
 const overrides=spacing?'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}':'';
 writeFileSync(`tmp/${name}.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><title>Audit keyboard audit</title><style>${css}${overrides}</style><body><button id="open">Open local audit log</button><script>${code.replace(/<\/script/gi,'<\\/script')}</script></body></html>`);
 for(const lang of ['en','fr'])for(const theme of ['light','dark'])writeFileSync(`tmp/${name}-${lang}-${theme}-320.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><title>Current audit keyboard ${phase} ${lang} ${theme}</title><iframe title="Local audit table at 320 by 400 CSS pixels" style="width:320px;height:400px;border:0" src="${name}.html?lang=${lang}&theme=${theme}"></iframe><p id="metrics"></p><script>addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.audit==='audit-keyboard')document.querySelector('#metrics').textContent=event.data.description;});</script></html>`);
}
console.log('Built current audit components, styles and fonts; phase:',phase);
