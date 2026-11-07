import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { board, item, validateBoard } from '../src/model.js';

const cases = JSON.parse(await readFile(new URL('./wcag-current-app/ai-native-boards.json', import.meta.url), 'utf8'));
const plan = board('Offline native task frame filter');
plan.id = 'wcag-offline-native-task-frame-filter';
plan.items = [];
for (let n = 1; n <= 12; n++) {
  const title = `Cadre ${n}: Veuillez discuter les prochaines étapes. Read first. Merci de lire attentivement.`;
  const frame = item('frame', (n - 1) * 900, 0, {
    text: title, lang: 'fr-CA', w: 800, h: 600,
    textRuns: [{ start: title.indexOf('Read'), end: title.indexOf('Read') + 'Read first.'.length, style: { lang: 'en-CA' } }],
  });
  const phrase = `Tâche ${n}: Veuillez choisir les prochaines étapes. Read first.`;
  const note = item('note', frame.x + 20, 80, {
    text: phrase + (n === 1 ? ' Merci de lire attentivement.'.repeat(30) : ''),
    lang: 'fr-CA', parentId: frame.id,
    textRuns: [{ start: phrase.indexOf('Read'), end: phrase.length, style: { lang: 'en-CA' } }],
    task: { status: 'todo', start: '2026-10-01', due: '2026-10-02' },
  });
  plan.items.push(frame, note);
}
validateBoard(plan);
await writeFile(new URL('./wcag-tasks-native-board.json', import.meta.url), JSON.stringify(plan, null, 2) + '\n');
const report = String.raw`<script>
setInterval(() => {
 const dialog=document.querySelector('dialog[open]'), focus=document.activeElement,
 choices=document.querySelector('.task-frame-filter .slide-choices'), selected=document.querySelector('#tasks-frame-selected'),
 preview=document.querySelector('#tasks-title-preview'), rect=focus?.getBoundingClientRect();
 parent.postMessage({audit:'tasks-file',description:JSON.stringify({viewport:[innerWidth,innerHeight],lang:document.documentElement.lang,theme:document.documentElement.dataset.theme,
 focus:focus?.getAttribute('aria-label')||focus?.textContent?.trim().slice(0,160)||focus?.id, focusId:focus?.id, focusRect:rect?[rect.x,rect.y,rect.width,rect.height]:null,
 dialogScrollTop:dialog?.scrollTop,frameOpen:document.querySelector('#tasks-frame')?.open,
 frameScroll:choices?[choices.scrollTop,choices.scrollHeight-choices.clientHeight]:null,
 selectedFrame:selected?.textContent,checkedFrame:document.querySelector('.task-frame-choice:checked')?.value,
 selectedLanguages:selected?[...selected.querySelectorAll('[lang]')].map(el=>el.lang):null,
 visibleTaskRows:[...document.querySelectorAll('.task-table-wrap:not([hidden]) tbody tr')].filter(el=>!el.closest('[hidden]')).length,
 preview:preview?{hidden:preview.hidden,scroll:[preview.scrollTop,preview.scrollHeight-preview.clientHeight]}:null,
 fontLoaded:document.fonts.check('14px "DM Sans"')})},'*');
},250);
</script>`;
const hashes = {};
for (const lang of ['en', 'fr']) {
  let html = await readFile(new URL(`./wcag-ai-file-final-${lang}-empty.html`, import.meta.url), 'utf8');
  const seed = JSON.stringify(cases[lang + '-empty']);
  if (!html.includes(seed)) throw Error('Original seed missing');
  html = html.replace(seed, JSON.stringify(plan)).replace(`Offline actual AI final ${lang} empty`, `Offline actual Tasks final ${lang}`) + report;
  const name = `wcag-tasks-file-final-${lang}.html`;
  await writeFile(new URL(name, import.meta.url), html);
  hashes[name] = createHash('sha256').update(html).digest('hex');
  const wrapper = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Offline native AI Tasks ${lang}</title><iframe title="Offline actual Whiteboard tasks" style="width:320px;height:300px;border:0" src="${name}"></iframe><p id="metrics"></p><script>addEventListener('message',e=>{if(e.data?.audit==='tasks-file')document.getElementById('metrics').textContent=e.data.description;});</script></html>`;
  await writeFile(new URL(`./wcag-tasks-file-final-${lang}-300.html`, import.meta.url), wrapper);
}
await writeFile(new URL('./wcag-tasks-native-file-assets.json', import.meta.url), JSON.stringify({sourceAssets:JSON.parse(await readFile(new URL('./wcag-ai-native-file-assets.json', import.meta.url),'utf8')),hosts:hashes,notes:'Unchanged current production bundle/CSS/fonts; isolated local board seed and passive frame/preview readout; no SDK or network.'},null,2)+'\n');
console.log('Wrote actual-app task fixtures for English/light and French/dark/spacing, 12 declared frames and 12 tasks.');
