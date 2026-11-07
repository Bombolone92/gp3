// A modal dialog with free-form content for the file features (the shared
// formDialog marks every field required, which optional metadata cannot use).
export function modal(opts: {
  title: string;
  body: string;
  submit: string;
  className?: string;
  extra?: { id: string; label: string }[];
  bind?: (dialog: HTMLDialogElement) => void;
}): Promise<{ action: string; form: HTMLFormElement; dialog: HTMLDialogElement; close: () => void } | null> {
  const dialog = document.createElement('dialog');
  dialog.className = `files-dialog ${opts.className ?? ''}`;
  dialog.setAttribute('aria-label', opts.title);
  const extra = (opts.extra ?? []).map((b) => `<button type="button" data-act="${b.id}">${b.label}</button>`).join('');
  dialog.innerHTML = `<form method="dialog"><h2>${opts.title}</h2>${opts.body}<div class="dialog-actions"><button type="button" data-act="cancel">Cancel</button>${extra}<button type="submit" class="primary">${opts.submit}</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  return new Promise((resolve) => {
    const done = (action: string | null) => {
      if (action === null) {
        close();
        resolve(null);
      } else resolve({ action, form, dialog, close });
    };
    dialog.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      done(null);
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      done('submit');
    });
    for (const b of dialog.querySelectorAll<HTMLButtonElement>('[data-act]'))
      b.addEventListener('click', () => done(b.dataset.act === 'cancel' ? null : b.dataset.act!));
    opts.bind?.(dialog);
    dialog.showModal();
  });
}
export const fieldValue = (form: HTMLFormElement, name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
export const fieldChecked = (form: HTMLFormElement, name: string) => !!(form.elements.namedItem(name) as HTMLInputElement | null)?.checked;
