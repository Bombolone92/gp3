import {build} from 'vite';
import {writeFile} from 'node:fs/promises';
const bundle=await build({configFile:false,logLevel:'silent',build:{write:false,rollupOptions:{input:'tmp/wcag-feedback-native-entry.js',output:{manualChunks:()=> 'index'}}}});
let css=bundle.output.filter(f=>f.type==='asset'&&f.fileName.endsWith('.css')).map(f=>f.source).join('\n');
for(const f of bundle.output.filter(f=>f.type==='asset'&&f.fileName.endsWith('.woff2')))css=css.replaceAll('/'+f.fileName,'data:font/woff2;base64,'+Buffer.from(f.source).toString('base64'));
const code=bundle.output.find(f=>f.type==='chunk'&&f.isEntry).code.replaceAll('</script','<\\/script');
const controls='<main lang="en" data-user-content><h1>Offline feedback layout audit</h1><p>Feedback stays in this local fixture.</p><button id="fixture-help">Help</button><button id="fixture-report">Report</button><label>Language<select id="fixture-language"><option value="en">English</option><option value="fr">Français</option></select></label><label>Theme<select id="fixture-theme"><option value="light">Light</option><option value="dark">Dark</option></select></label></main>';
for(const spacing of [false,true]){
 const name='wcag-feedback'+(spacing?'-spacing':'')+'-native.html';
 const overrides=spacing?'html *{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}':'';
 await writeFile('tmp/'+name,'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline feedback layout audit</title><style>'+css+'\n'+overrides+'</style><body>'+controls+'<script type="module">'+code+'</script></body></html>');
 await writeFile('tmp/wcag-feedback'+(spacing?'-spacing':'')+'-320.html','<!doctype html><html><meta charset="utf-8"><title>Feedback 320 by 400 layout audit</title><iframe title="Offline feedback layout audit" src="'+name+'" width="320" height="400" style="border:1px solid"></iframe></html>');
}
console.log('Current Help/admin components and styles bundled as local-only 320 × 400 layout fixtures; no rendered result is claimed.');
