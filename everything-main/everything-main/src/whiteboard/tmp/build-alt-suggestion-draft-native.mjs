import {build} from 'vite';
import {createCanvas} from '@napi-rs/canvas';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const phases=process.argv.slice(2).length?process.argv.slice(2):['before','candidate'];
const root='tmp/alt-suggestion-draft-native';await mkdir(join(root,'assets'),{recursive:true});
const canvas=createCanvas(4,4);canvas.getContext('2d').fillRect(0,0,4,4);
const template=(await readFile('tmp/alt-suggestion-draft-native-entry-template.js','utf8')).replace('FIXTURE_IMAGE_SRC',JSON.stringify(canvas.toDataURL()));
const manifest=[];
for(const phase of phases){
 if(!['before','candidate','final'].includes(phase))throw Error('Unknown phase');
 const source=phase==='candidate'?'tmp/alt-suggestion-draft-candidate.js':'src/accessibility/alt-text.js';
 const entry=`tmp/alt-suggestion-draft-native-${phase}-entry.js`;
 await writeFile(entry,phase==='candidate'?template.replace("from '../src/accessibility/alt-text.js'","from './alt-suggestion-draft-candidate.js'"):template);
 const result=await build({configFile:false,logLevel:'silent',build:{write:false,rollupOptions:{input:entry,output:{entryFileNames:`assets/alt-draft-${phase}.js`}}}});
 for(const out of result.output)await writeFile(join(root,out.fileName),out.type==='asset'?out.source:out.code);
 const css=result.output.find(out=>out.type==='asset'&&out.fileName.endsWith('.css'));if(!css)throw Error('Missing actual dialog CSS');
 await writeFile(join(root,phase+'.html'),`<!doctype html><meta charset="utf-8"><title>Actual alternative text ${phase}</title><link rel="stylesheet" href="/${css.fileName}"><style>body{min-height:100dvh}#open{position:absolute;left:20px;top:20px}</style><button id="open">Open alternative text</button><script type="module" src="/assets/alt-draft-${phase}.js"></script>`);
 for(const locale of ['en','fr'])await writeFile(join(root,`view-${phase}-${locale}.html`),`<!doctype html><meta charset="utf-8"><title>Pending alternative text ${phase} ${locale}</title><style>body{margin:0;overflow:hidden}iframe{width:640px;height:650px;border:0}pre{position:fixed;left:652px;top:0;width:1100px;white-space:pre-wrap;font:15px monospace}</style><iframe src="${phase}.html?locale=${locale}"></iframe><pre></pre><script>addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&'pending'in e.data)document.querySelector('pre').textContent=JSON.stringify(e.data,null,2);});</script>`);
 manifest.push({phase,source,sourceSHA256:createHash('sha256').update(await readFile(source)).digest('hex'),assets:result.output.map(o=>o.fileName)});
}
console.log(JSON.stringify({root,scope:'Actual alternative text component and image scaling; held local AI reply released by explicit fixture control; original board unchanged until real Save; no external AI calls.',manifest}));
