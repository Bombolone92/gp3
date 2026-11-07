// Dialogs a running script may show. Every one names the script it comes
// from, so a script cannot pass its questions off as the app's own, and
// file access always goes through a picker the user operates.
import './scripting.css';
import type { Editor } from '../../editor';
import { escapeXML } from '../../model/assets';
import { svg } from '../../app/icons';
import type { ScriptField, ScriptFile, ScriptUI } from './host';

const esc = (v: unknown) => escapeXML(String(v));

/** A modal dialog for a script; resolves with the button pressed (null on
 * Escape). Buttons marked to stay open act within the dialog. */
function scriptDialog(scriptName: string, title: string, body: string, buttons: [string, string, 'stay'?][], bind?: (d: HTMLDialogElement) => void): Promise<{ action: string; form: HTMLFormElement } | null> {
  const dialog = document.createElement('dialog');
  dialog.className = 'files-dialog script-dialog';
  dialog.setAttribute('aria-label', title);
  const primary = buttons.at(-1)!;
  dialog.innerHTML = `<form method="dialog"><p class="script-origin" title="This window comes from a script you installed">${svg('square-code', 13)}<span>Script: ${esc(scriptName)}</span></p><h2>${esc(title)}</h2>${body}<div class="dialog-actions">${buttons
    .slice(0, -1)
    .map(([id, label]) => `<button type="button" data-act="${id}">${esc(label)}</button>`)
    .join('')}<button type="submit" class="primary" data-act="${primary[0]}">${esc(primary[1])}</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form')!;
  return new Promise((resolve) => {
    const done = (action: string | null) => {
      dialog.close();
      dialog.remove();
      resolve(action === null ? null : { action, form });
    };
    dialog.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      done(null);
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (form.reportValidity()) done(primary[0]);
    });
    for (const [id, , stay] of buttons.slice(0, -1))
      if (!stay) dialog.querySelector(`button[data-act="${id}"]`)!.addEventListener('click', () => done(id === 'cancel' ? null : id));
    bind?.(dialog);
    dialog.showModal();
  });
}
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => `<p class="script-message">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

function fieldHtml(f: ScriptField, i: number) {
  const id = `script-field-${i}`;
  const range = (k: 'min' | 'max' | 'step') => (f[k] !== undefined ? `${k}="${f[k]}"` : '');
  const name = `name="${esc(f.name)}" id="${id}"`;
  let control: string;
  if (f.type === 'checkbox') return `<label class="dialog-field checkbox-field" for="${id}">${esc(f.label)}<input type="checkbox" ${name} ${f.value === true || f.value === 'yes' ? 'checked' : ''}></label>`;
  if (f.type === 'select') control = `<select ${name}>${(f.options ?? []).map(([v, l]) => `<option value="${esc(v)}" ${String(f.value) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') control = `<textarea ${name} rows="4">${esc(f.value)}</textarea>`;
  else if (f.type === 'range') control = `<span class="script-range"><input type="range" ${name} ${range('min')} ${range('max')} ${range('step')} value="${esc(f.value)}"><output for="${id}">${esc(f.value)}</output></span>`;
  else if (f.type === 'number') control = `<input type="number" ${name} ${range('min')} ${range('max')} ${f.step !== undefined ? range('step') : 'step="any"'} value="${esc(f.value)}" required>`;
  else if (f.type === 'color') control = `<input type="color" ${name} value="${/^#[0-9a-f]{6}$/i.test(String(f.value)) ? esc(f.value) : '#000000'}">`;
  else control = `<input type="text" ${name} value="${esc(f.value)}" autocomplete="off">`;
  return `<label class="dialog-field" for="${id}">${esc(f.label)}${control}</label>`;
}

/** The dialogs and pickers of one script run. */
export function scriptUI(e: Editor, scriptName: string, progress: (fraction: number | null, message: string) => void): ScriptUI {
  return {
    async alert(message, title) {
      await scriptDialog(scriptName, title, paragraphs(message), [['ok', 'OK']]);
    },
    async confirm(message, title) {
      return (await scriptDialog(scriptName, title, paragraphs(message), [['cancel', 'Cancel'], ['ok', 'OK']]))?.action === 'ok';
    },
    async prompt(message, value, title) {
      const r = await scriptDialog(scriptName, title, `${paragraphs(message)}<label class="dialog-field"><input type="text" name="answer" value="${esc(value)}" autocomplete="off" aria-label="Answer"></label>`, [['cancel', 'Cancel'], ['ok', 'OK']]);
      return r ? (r.form.elements.namedItem('answer') as HTMLInputElement).value : null;
    },
    async form(title, fields, submit, message) {
      const r = await scriptDialog(scriptName, title, `${message ? paragraphs(message) : ''}<div class="script-form">${fields.map(fieldHtml).join('')}</div>`, [['cancel', 'Cancel'], ['ok', submit]], (d) => {
        for (const input of d.querySelectorAll<HTMLInputElement>('input[type="range"]')) input.addEventListener('input', () => (input.nextElementSibling!.textContent = input.value));
      });
      if (!r) return null;
      const out: Record<string, string | number | boolean> = {};
      fields.forEach((f, i) => {
        const el = r.form.querySelector<HTMLInputElement>(`#script-field-${i}`)!;
        out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' || f.type === 'range' ? Number(el.value) : el.value;
      });
      return out;
    },
    progress,
    async openFiles(opts) {
      const accept = opts.accept === 'image' || !opts.accept ? (document.querySelector<HTMLInputElement>('#file-input')?.accept ?? 'image/*') : opts.accept;
      let picked: ScriptFile[] | null = null;
      const r = await scriptDialog(
        scriptName,
        opts.multiple ? 'Choose Files' : 'Choose a File',
        `<p class="script-message">The script asks to read ${opts.multiple ? 'files' : 'a file'}. It receives only what you choose.</p><p class="script-picked muted" aria-live="polite">Nothing chosen yet.</p>`,
        [['cancel', 'Cancel'], ['device', 'From this device…', 'stay'], ['puter', 'From Puter…', 'stay'], ['ok', 'Use']],
        (d) => {
          const use = d.querySelector<HTMLButtonElement>('button[type="submit"]')!;
          use.disabled = true;
          const status = d.querySelector<HTMLElement>('.script-picked')!;
          const show = (files: ScriptFile[]) => {
            picked = files;
            use.disabled = !files.length;
            status.textContent = files.length ? files.map((f) => f.name).join(', ') : 'Nothing chosen yet.';
          };
          const read = async (list: { name: string; type?: string; read: () => Promise<Blob> }[]) => show(await Promise.all(list.map(async (f) => { const b = await f.read(); return { name: f.name, type: b.type || f.type || '', data: new Uint8Array(await b.arrayBuffer()) }; })));
          // Pickers open from these buttons, not from the dialog's own close handling.
          d.querySelector('[data-act="device"]')!.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = accept;
            input.multiple = opts.multiple;
            input.onchange = () => void read(Array.from(input.files ?? []).map((f) => ({ name: f.name, type: f.type, read: async () => f })));
            input.click();
          });
          d.querySelector('[data-act="puter"]')!.addEventListener('click', () => {
            // The Puter picker never settles when dismissed; Cancel stays available.
            void import('../files/cloud').then(({ pickCloudFiles }) => pickCloudFiles(opts.multiple, accept)).then((items) => read(items.map((it) => ({ name: it.name, read: () => it.read() })))).catch((error) => (status.textContent = String(error instanceof Error ? error.message : error)));
          });
        },
      );
      return r ? (picked ?? []) : [];
    },
    async saveFiles(files, zipName) {
      const total = files.reduce((n, f) => n + f.data.length, 0);
      const size = total < 1024 * 1024 ? `${Math.max(1, Math.round(total / 1024))} KB` : `${(total / 1048576).toFixed(1)} MB`;
      const what = files.length === 1 ? `“${files[0].name}”` : `${files.length} files as “${zipName}”`;
      const r = await scriptDialog(scriptName, 'Save Files', `<p class="script-message">The script wants to save ${esc(what)} (${size}).</p>`, [['cancel', 'Cancel'], ['puter', 'Save to Puter…'], ['download', 'Download']]);
      if (!r) return false;
      let blob: Blob, name: string;
      if (files.length === 1) {
        blob = new Blob([files[0].data as Uint8Array<ArrayBuffer>], { type: files[0].type });
        name = files[0].name;
      } else {
        const { uniqueName, zipStore } = await import('../files/zip');
        const used = new Set<string>();
        blob = new Blob([zipStore(files.map((f) => ({ name: uniqueName(f.name, used), data: f.data }))) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
        name = zipName ?? 'files.zip';
      }
      if (r.action === 'puter') {
        // The Puter picker never settles when dismissed, so it is not awaited.
        const { cloudSaveAs } = await import('../files/cloud');
        void cloudSaveAs(blob, name)
          .then((item) => e.message(`Saved ${item.name} to Puter`))
          .catch((error) => e.message(String(error instanceof Error ? error.message : error)));
      } else {
        const { download } = await import('../../persistence/puter');
        download(blob, name);
      }
      return true;
    },
  };
}

/** The status strip shown while a script runs: name, progress and Stop. */
export function runIndicator(e: Editor, name: string, stop: () => void) {
  const el = document.createElement('div');
  el.className = 'script-run';
  el.setAttribute('role', 'status');
  el.hidden = true;
  el.innerHTML = `${svg('square-code', 14)}<span class="script-run-name">${esc(name)}</span><span class="script-run-message"></span><progress max="1" aria-label="Script progress"></progress><button type="button" class="script-run-stop" title="Stop the script (its changes so far stay as one undo step)">Stop</button>`;
  el.querySelector('button')!.addEventListener('click', stop);
  e.root.append(el);
  // Quick scripts finish without the strip flashing up.
  const timer = window.setTimeout(() => (el.hidden = false), 400);
  const bar = el.querySelector('progress')!;
  bar.removeAttribute('value');
  return {
    progress(fraction: number | null, message: string) {
      if (fraction === null) bar.removeAttribute('value');
      else bar.value = fraction;
      el.querySelector('.script-run-message')!.textContent = message;
      if (message || fraction !== null) el.hidden = false;
    },
    stopping() {
      el.querySelector('button')!.disabled = true;
      el.querySelector('.script-run-message')!.textContent = 'Stopping…';
    },
    remove() {
      clearTimeout(timer);
      el.remove();
    },
  };
}
