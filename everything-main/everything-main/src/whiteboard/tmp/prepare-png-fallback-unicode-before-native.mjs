import fs from 'node:fs';
import path from 'node:path';
import {board,item,validateBoard} from '../src/model.js';
const root='tmp/png-fallback-unicode-before-native';fs.mkdirSync(root,{recursive:true});
for(const name of ['assets','icons'])fs.cpSync('dist/'+name,path.join(root,name),{recursive:true});
const value=board();value.title='Q'.repeat(119)+'😀';value.items=[item('note',100,100,{text:'Original 😀',lang:'fr-CA',textRuns:[{start:9,end:11,style:{lang:'en-GB'}}]})];const fixture=validateBoard(value);
fs.writeFileSync('tmp/png-fallback-unicode-native-fixture.json',JSON.stringify(fixture));
let base=fs.readFileSync('tmp/bulk-preview-unicode-final-native/index-en.html','utf8').replace(/const fixture=.*?;\nawait new Promise/s,'const fixture='+JSON.stringify(fixture)+';\nawait new Promise');
base=base.replace("await import('/assets/", "window.ClipboardItem=undefined;await import('/assets/");
base=base.slice(0,base.lastIndexOf('<script>'))+`<script>let filename=null;document.addEventListener('click',e=>{const a=e.target.closest?.('a[download]');if(a){filename={value:a.download,length:a.download.length,valid:a.download.isWellFormed(),tail:a.download.slice(-20)};report();}},true);function report(){const field=document.querySelector('#board-title');const original=[...document.querySelectorAll('#board-outline [data-id]')].map(x=>({text:x.textContent,valid:x.textContent.isWellFormed(),lang:x.querySelector('[data-user-content]')?.lang,passage:x.querySelector('[lang="en-GB"]')?.textContent}));parent.postMessage({filename,title:field?{length:field.value.length,valid:field.value.isWellFormed(),tail:field.value.slice(-5)}:null,preview:!!document.querySelector('.image-copy-preview img'),retry:!!document.querySelector('#retry-image-copy'),status:document.querySelector('#image-copy-status')?.textContent,original,history:['undo','redo'].map(k=>document.querySelector('[data-action="'+k+'"]')?.disabled),locale:document.documentElement.lang},'*');}new MutationObserver(()=>requestAnimationFrame(report)).observe(document.body,{childList:true,subtree:true,attributes:true});</script>`;
for(const [locale,theme]of [['en','dark'],['fr','light']]){
 const html=base.replace("localStorage.setItem('whiteboard-language','en');","localStorage.setItem('whiteboard-language','"+locale+"');").replace("localStorage.setItem('whiteboard-theme','dark');","localStorage.setItem('whiteboard-theme','"+theme+"');");
 fs.writeFileSync(path.join(root,'index-'+locale+'.html'),html);
 fs.writeFileSync(path.join(root,'view-'+locale+'.html'),`<!doctype html><title>PNG filename before ${locale}</title><style>body{margin:0;overflow:hidden}iframe{width:1200px;height:800px;border:0}pre{position:fixed;left:1210px;top:0;width:650px;white-space:pre-wrap;font:15px monospace}</style><iframe src="index-${locale}.html#local=${fixture.id}"></iframe><pre></pre><script>addEventListener('message',e=>{if(e.source===document.querySelector('iframe').contentWindow&&'filename'in e.data)document.querySelector('pre').textContent=JSON.stringify(e.data,null,2);});</script>`);
}
console.log({id:fixture.id,asset:base.match(/await import\('([^']+)'\)/)?.[1],titleValid:fixture.title.isWellFormed()});
