import { createFacilitationUI } from '../src/facilitation/ui.js';
import { board as newBoard } from '../src/model.js';
import { participantKey } from '../src/facilitation/model.js';
import { setLanguage } from '../src/i18n.js';
import '../src/style.css';
import '../src/facilitation/facilitation.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';

const params = new URLSearchParams(location.search);
const locale = params.get('lang') === 'fr' ? 'fr' : 'en';
setLanguage(locale);
document.documentElement.lang = locale;
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const board = newBoard('Local workshop summary');
board.workshop = {
  session: { id: 's1', state: 'ended', startedAt: 1000, endedAt: 700000 },
  ...Object.fromEntries(['Alice', 'Bob', 'Claire'].map((name, n) => [participantKey(`local-${n}`), {
    by: `local-${n}`, name, role: n === 0 ? 'owner' : 'editor', session: 's1', first: 1000, last: 600000,
  }])),
};
board.comments = [{ id: 'local-thread', x: 0, y: 0, resolved: false, messages: ['Alice', 'Bob', 'Claire'].map((authorName, n) => ({
  id: `local-message-${n}`, authorId: `local-${n}`, authorName, text: 'Local summary sample.', createdAt: 7000 + n * 1000,
})) }];
let lastKey = 'none';
const update = () => {
  const scroller = document.querySelector('.fac-table-wrap');
  if (!scroller) return;
  const focus = document.activeElement;
  const description = `table=${Math.round(scroller.scrollLeft)}/${scroller.scrollWidth - scroller.clientWidth}; focus=${focus?.id || focus?.tagName}; rows=${scroller.querySelectorAll('tbody tr').length}; key=${lastKey}`;
  parent.postMessage({ audit: 'summary-keyboard', description }, location.origin);
};
const ui = createFacilitationUI({
  board: () => board, identity: () => ({ id: 'local-0', name: 'Alice' }), role: () => 'owner',
  canParticipate: () => true, canEdit: () => true, now: () => 800000,
  view: () => ({ x: 0, y: 0, z: 1 }), canvas: () => document.querySelector('canvas'),
  hidden: () => new Map(), selection: () => new Set(), select() {},
  commit() { throw Error('Read-only local diagnostic.'); }, setTimer() {}, focusFrame() {}, bring() {}, follow() {},
  session: () => null, roster: () => [], icon: () => '', toast() {}, draw() {},
  download(data) { document.querySelector('#csv').textContent = data; },
});
ui.bind(document.querySelector('.canvas-wrap'));
document.querySelector('[data-action="facilitation"]').onclick = () => ui.open('summary');
ui.open('summary');
document.addEventListener('focusin', update);
document.addEventListener('scroll', update, true);
document.addEventListener('keydown', event => {
  setTimeout(() => { lastKey = event.key + ':prevented=' + event.defaultPrevented; update(); }, 0);
}, true);
requestAnimationFrame(update);
