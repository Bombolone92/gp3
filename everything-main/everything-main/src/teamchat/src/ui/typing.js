/**
 * "Ana is typing" under the composer, in its bottom margin. The line
 * always takes the same height, empty or not, so it never moves the
 * messages or the composer;
 * it is ambient, so nothing is announced to assistive tech; and muted
 * conversations show nothing.
 */
import { el } from './dom.js';
import { store } from '../lib/store.js';
import { typingText } from '../lib/typing.js';

export function createTypingLine(convId) {
  const text = el('span.typing-text');
  const dots = el('span.typing-dots', { 'aria-hidden': 'true' }, el('i'), el('i'), el('i'));
  const node = el('div.typing-line', { 'aria-hidden': 'true' }, dots, text);
  let timer = null;
  function render() {
    const names = store.isMuted(convId) ? [] : store.typingIn(convId).map((u) => store.member(u).name);
    const line = typingText(names);
    text.textContent = line;
    node.classList.toggle('on', !!line);
    clearTimeout(timer);
    // Entries expire on their own when polling pauses; re-check then.
    if (line) timer = setTimeout(render, 4000);
  }
  const off = [store.on('typing', render), store.on('workspace', render)];
  render();
  return {
    el: node,
    destroy() {
      clearTimeout(timer);
      off.forEach((f) => f());
    },
  };
}
