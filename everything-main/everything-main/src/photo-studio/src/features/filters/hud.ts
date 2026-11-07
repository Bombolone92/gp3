import type { Editor } from '../../editor';
import { escapeXML } from '../../model/assets';

/** A progress bar with Cancel over the canvas for filters applied without a
 * dialog. It appears only if the work takes longer than a moment. */
export function progressHud(e: Editor, label: string, cancel: () => void) {
  let el: HTMLElement | undefined;
  let value = 0;
  const timer = window.setTimeout(() => {
    el = document.createElement('div');
    el.className = 'filter-hud';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${escapeXML(label)}</span><progress max="1" value="${value}"></progress><button type="button">Cancel</button>`;
    el.querySelector('button')!.addEventListener('click', cancel);
    e.root.append(el);
  }, 250);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cancel();
  };
  document.addEventListener('keydown', onKey);
  return {
    set(f: number) {
      value = f;
      el?.querySelector('progress')?.setAttribute('value', String(f));
    },
    close() {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      el?.remove();
    },
  };
}
