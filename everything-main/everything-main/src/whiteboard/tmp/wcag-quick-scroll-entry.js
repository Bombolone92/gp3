import { createQuickConnectUI } from '../src/quick-connect-ui.js';
import { board, item, validateBoard } from '../src/model.js';
import { setLanguage } from '../src/i18n.js';
import '../src/style.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';

const params = new URLSearchParams(location.search);
setLanguage(params.get('lang') === 'fr' ? 'fr' : 'en');
document.documentElement.lang = params.get('lang') === 'fr' ? 'fr' : 'en';
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const root = document.querySelector('#quick-ports');
const y = root.clientHeight / 2 - 50;
const source = item('rect', 60, y, { w: 100, h: 100, text: 'Start' });
const target = item('ellipse', 260, y, {
  w: 100, h: 100,
  text: 'Internationalisation des communications et coordination des consultations. Harmonisation des recommandations interministérielles et suivi des décisions finales.',
  lang: 'fr-CA',
});
const local = { ...board('Local Quick connect'), items: [source, target] };
validateBoard(local);
const calls = { activated: 0, started: 0, cancelled: 0 };
let ui, lastKey = 'none';
const update = () => {
  const tip = root.querySelector('[role="tooltip"]:not([hidden])');
  const description = `tooltip=${tip ? Math.round(tip.scrollTop) + '/' + (tip.scrollHeight - tip.clientHeight) : 'hidden'}; root=${root.clientWidth}x${root.clientHeight}; focus=${document.activeElement?.dataset.quickDirection || document.activeElement?.id || document.activeElement?.tagName}; activated=${calls.activated}; started=${calls.started}; key=${lastKey}`;
  parent.postMessage({ audit: 'quick-scroll', description }, location.origin);
};
ui = createQuickConnectUI({
  state: () => ({ board: local, source, view: { x: 0, y: 0, z: 1 } }),
  draw() { ui.render(); requestAnimationFrame(update); },
  activate() { calls.activated++; update(); },
  start() { calls.started++; update(); return true; },
  move() {}, end() {}, cancel() { calls.cancelled++; },
  focusCanvas() { document.querySelector('#canvas').focus(); },
});
ui.bind(root);
ui.render();
document.addEventListener('focusin', update);
document.addEventListener('scroll', update, true);
document.addEventListener('keydown', event => {
  setTimeout(() => { lastKey = event.key + ':prevented=' + event.defaultPrevented; update(); }, 0);
}, true);
document.querySelector('#canvas').focus();
requestAnimationFrame(update);
