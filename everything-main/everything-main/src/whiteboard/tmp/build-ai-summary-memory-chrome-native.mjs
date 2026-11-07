import {build} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root='tmp/ai-summary-memory-chrome-native';await mkdir(join(root,'assets'),{recursive:true});
for(const mode of ['before','candidate']){
 const result=await build({configFile:false,logLevel:'silent',build:{write:false,rollupOptions:{input:'tmp/ai-summary-memory-chrome-'+mode+'-entry.js',output:{entryFileNames:'assets/ai-memory-chrome-'+mode+'.js'}}}});
 for(const out of result.output)await writeFile(join(root,out.fileName),out.type==='asset'?out.source:out.code);
 const css=result.output.find(out=>out.type==='asset'&&out.fileName.endsWith('.css'));if(!css)throw Error('Missing CSS');
 const html='<!doctype html><meta charset="utf-8"><title>Actual Chrome memory component '+mode+'</title><link rel="stylesheet" href="/'+css.fileName+'"><style>body{min-height:800px}#open{position:absolute;left:30px;top:30px}#inspect{position:absolute;left:30px;top:70px}</style><button id="open">Open AI assistant</button><button id="inspect">Refresh memory reading</button><script type="module" src="/assets/ai-memory-chrome-'+mode+'.js"></script>';
 await writeFile(join(root,'index-'+mode+'.html'),html);
 await writeFile(join(root,'view-'+mode+'.html'),'<!doctype html><title>Chrome summary memory '+mode+'</title><style>body{margin:0;overflow:hidden}iframe{width:1200px;height:800px;border:0}pre{position:fixed;left:1210px;top:0;width:650px;white-space:pre-wrap;font:15px monospace}</style><iframe src="index-'+mode+'.html?locale=en"></iframe><pre></pre><script>addEventListener("message",e=>{if(e.source===document.querySelector("iframe").contentWindow&&"sent"in e.data)document.querySelector("pre").textContent=JSON.stringify(e.data,null,2);});</script>');
 console.log(JSON.stringify({mode,assets:result.output.map(out=>out.fileName)}));
}
