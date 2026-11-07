import type { Editor } from '../../editor';

/** Choosing from a menu or checkbox returns keys to the canvas, so Enter and
 * Escape commit or cancel right away. Number fields keep focus while typing. */
const refocusBound = new WeakSet<HTMLElement>();
export function refocusAfterChoice(e: Editor, el: HTMLElement) {
  // The options bar element persists across tools; bind it once.
  if (refocusBound.has(el)) return;
  refocusBound.add(el);
  el.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.tagName === 'SELECT' || t.type === 'checkbox') e.el('#viewport').focus({ preventScroll: true });
  });
}
