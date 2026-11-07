// Warning dialogs that offer "Don't show again". Dismissed warnings are kept
// in preferences until General → Reset All Warning Dialogs.
import type { Editor } from '../../editor';
import { escapeXML } from '../../model/assets';

/** Show a warning unless it was dismissed. Resolves true to continue
 * (always true for a dismissed warning) and false when cancelled. */
export function warnOnce(e: Editor, id: string, title: string, message: string, ok = 'Continue', cancel: string | null = 'Cancel'): Promise<boolean> {
  if (e.preferences.dismissedWarnings.includes(id)) return Promise.resolve(true);
  const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
  return new Promise((resolve) => {
    dialog.innerHTML = `<form method="dialog" class="warning-dialog"><h2>${escapeXML(title)}</h2><p>${escapeXML(message)}</p><label class="checkbox-field dialog-field"><span>Don’t show again</span><input type="checkbox" name="dismiss"></label><div class="dialog-actions">${cancel ? `<button type="button" data-cancel>${escapeXML(cancel)}</button>` : ''}<button type="submit" class="primary">${escapeXML(ok)}</button></div></form>`;
    const form = dialog.querySelector('form')!;
    const finish = (value: boolean) => {
      if (value && form.querySelector<HTMLInputElement>('[name="dismiss"]')!.checked) {
        e.preferences.dismissedWarnings = [...new Set([...e.preferences.dismissedWarnings, id])];
        e.savePreferences();
      }
      dialog.close();
      resolve(value);
    };
    dialog.querySelector('[data-cancel]')?.addEventListener('click', () => finish(false));
    dialog.oncancel = () => resolve(false);
    form.onsubmit = (ev) => {
      ev.preventDefault();
      finish(true);
    };
    dialog.showModal();
  });
}

/** Ask a choice once per call (no "don't show again"); resolves the chosen value or null. */
export function askChoice<T extends string>(title: string, message: string, choices: [T, string][]): Promise<T | null> {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
  return new Promise((resolve) => {
    dialog.innerHTML = `<form method="dialog"><h2>${escapeXML(title)}</h2><p>${escapeXML(message)}</p><div class="dialog-actions"><button type="button" data-cancel>Cancel</button>${choices.map(([v, l], i) => `<button type="button" data-choice="${escapeXML(v)}" class="${i === choices.length - 1 ? 'primary' : ''}">${escapeXML(l)}</button>`).join('')}</div></form>`;
    const done = (v: T | null) => {
      dialog.close();
      resolve(v);
    };
    dialog.querySelector('[data-cancel]')!.addEventListener('click', () => done(null));
    dialog.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => b.addEventListener('click', () => done(b.dataset.choice as T)));
    dialog.oncancel = () => resolve(null);
    dialog.showModal();
  });
}
