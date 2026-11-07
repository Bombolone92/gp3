import {build} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root='tmp/ai-summary-omission-native';
await mkdir(join(root,'assets'),{recursive:true});
for(const version of ['before','final']) {
 const result=await build({configFile:false,logLevel:'silent',build:{write:false,rollupOptions:{input:`tmp/ai-summary-omission-native-${version}-entry.js`,output:{entryFileNames:`assets/scope-${version}.js`}}}});
 for(const out of result.output)await writeFile(join(root,out.fileName),out.type==='asset'?out.source:out.code);
 const css=result.output.find(out=>out.type==='asset'&&out.fileName.endsWith('.css'));if(!css)throw Error('Missing actual AI CSS');
 await writeFile(join(root,version+'.html'),`<!doctype html><meta charset="utf-8"><title>Actual AI summary scope ${version}</title><link rel="stylesheet" href="/${css.fileName}"><style>body{min-height:100dvh}#open{position:absolute;left:20px;top:20px}body.spacing,body.spacing :where(p,button,small,label,.field,[role="textbox"]){line-height:1.5;letter-spacing:.12em;word-spacing:.16em}body.spacing p{margin-bottom:2em}</style><button id="open">Open AI assistant</button><script type="module" src="/assets/scope-${version}.js"></script>`);
 for(const locale of ['en','fr']) for(const narrow of [false,true]) {
  const width=narrow?320:640,height=narrow?400:650;
  await writeFile(join(root,`view-${version}-${locale}${narrow?'-spacing':''}.html`),`<!doctype html><meta charset="utf-8"><title>AI summary scope ${version} ${locale}${narrow?' spacing':''}</title><style>body{margin:0;overflow:hidden}iframe{width:${width}px;height:${height}px;border:0}pre{position:fixed;left:${width+12}px;top:0;width:1100px;white-space:pre-wrap;font:15px monospace}</style><iframe src="${version}.html?locale=${locale}${narrow?'&spacing=1':''}"></iframe><pre></pre><script>addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&'sent'in e.data)document.querySelector('pre').textContent=JSON.stringify(e.data,null,2);});</script>`);
 }
}
console.log(JSON.stringify({root,scope:'Actual before/final AI component, source styles and icons; local controlled responses only; 31 valid objects and omitted decision; normal and 320x400 text-spacing variants.'}));
