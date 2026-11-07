import {build} from 'vite';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
export async function appBundle(){
 const source=resolve('src/ai/ai-ui.js');
 const candidate=process.env.WHITEBOARD_AI_SCOPE_CANDIDATE;
 const bundle=await build({configFile:false,logLevel:'silent',plugins:candidate?[{name:'test-summary-scope',async load(id){if(id!==source)return null;return (await readFile('tmp/ai-summary-scope-candidate.js','utf8')).replaceAll('"../src/','"'+resolve('src')+'/');}}]:[],build:{write:false,rollupOptions:{output:{manualChunks:id=>/pdfjs-dist/.test(id)?undefined:'index'}}}});
 return bundle.output.find(f=>f.type==='chunk'&&f.isEntry).code;
}
