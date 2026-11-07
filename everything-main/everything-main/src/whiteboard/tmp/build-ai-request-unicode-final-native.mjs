import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root='tmp/ai-request-unicode-final-native';
const result=await build({configFile:false,logLevel:'silent',build:{write:false,rollupOptions:{input:'tmp/ai-request-unicode-native-final-entry.js',output:{entryFileNames:'assets/ai-final.js'}}}});
await mkdir(join(root,'assets'),{recursive:true});
for(const out of result.output)await writeFile(join(root,out.fileName),out.type==='asset'?out.source:out.code);
const css=result.output.find(out=>out.type==='asset'&&out.fileName.endsWith('.css'));
if(!css)throw Error('Missing full AI component CSS');
const before=await readFile('tmp/ai-request-unicode-before-native/index.html','utf8');
const html=before.replace('Actual AI request component','Actual AI request final component').replace(/href="\/assets\/[^"]+\.css"/,'href="/'+css.fileName+'"').replace('/assets/ai-before-complete.js','/assets/ai-final.js');
await writeFile(join(root,'index.html'),html);
for(const locale of ['en','fr'])for(const mode of ['themes','summary']){
 const file='view-'+locale+'-'+mode+'.html';
 const beforeView=await readFile(join('tmp/ai-request-unicode-before-native',file),'utf8');
 await writeFile(join(root,file),beforeView.replace('AI request before','AI request final'));
}
console.log(JSON.stringify({root,assets:result.output.map(out=>out.fileName),entry:'tmp/ai-request-unicode-native-final-entry.js',scope:'Actual createAI, source organization/facilitation styles and icons; controlled local org.request, no external AI calls'}));
