import {build} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root='tmp/ai-summary-prompt-memory-before-native';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,rollupOptions:{input:'tmp/ai-summary-prompt-memory-native-before-entry.js',output:{entryFileNames:'assets/ai-memory-before.js'}}}});
await mkdir(join(root,'assets'),{recursive:true});
for(const out of result.output)await writeFile(join(root,out.fileName),out.type==='asset'?out.source:out.code);
const css=result.output.find(out=>out.type==='asset'&&out.fileName.endsWith('.css'));if(!css)throw Error('Missing AI CSS');
const html=(await readFile('tmp/ai-request-unicode-before-native/index.html','utf8')).replace('Actual AI request component','Actual AI summary memory component').replace(/href="\/assets\/[^"]+\.css"/,'href="/'+css.fileName+'"').replace('/assets/ai-before-complete.js','/assets/ai-memory-before.js');await writeFile(join(root,'index.html'),html);
for(const locale of ['en','fr']){const html=(await readFile('tmp/ai-request-unicode-before-native/view-'+locale+'-summary.html','utf8')).replace('AI request before','AI summary memory before');await writeFile(join(root,'view-'+locale+'.html'),html);}
console.log(JSON.stringify({root,assets:result.output.map(out=>out.fileName),scope:'Actual createAI/source CSS/icons; valid 5,000-object board; controlled local org.request only'}));
