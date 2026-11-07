// Shared pieces of the multi-image commands: a dialog that collects source
// images (this device, Puter or open documents) plus command settings, image
// loading, and opening results as new documents.
import type { Editor } from '../../editor';
import type { DocumentSession } from '../../app/session';
import type { RGBA8 } from '../../imaging/types';
import type { Layer, PhotoDocument } from '../../model/document';
import { escapeXML } from '../../model/assets';
import { newPixelLayer } from '../../model/pixel-layer';
import { gridFromImage } from '../../model/tiles';
import { toRGBA8 } from '../pixels';
import { pickCloudFiles } from '../files/cloud';
import { decodeFile } from '../files/open';

export type Input = { name: string; blob?: Blob; load?: () => Promise<Blob>; session?: DocumentSession };
const rasterAccept = '.tif,.tiff,.bmp,.dib,.gif,.tga,.pbm,.pgm,.ppm,.pnm,.pam,image/*';

export type InputsDialog = {
  dialog: HTMLDialogElement;
  form: HTMLFormElement;
  status: HTMLElement;
  inputs: Input[];
  // Resolves with true when the user runs the command, false when cancelled.
  result: Promise<boolean>;
  close(): void;
  setBusy(busy: boolean): void;
  onChange(fn: () => void): void;
};

/** A dialog with an image list (step 1) followed by command-specific settings. */
export function inputsDialog(e: Editor, title: string, settings: string, opts: { min?: number; max?: number; submit?: string; preview?: boolean } = {}): InputsDialog {
  const min = opts.min ?? 2;
  const inputs: Input[] = [];
  const dialog = document.createElement('dialog');
  dialog.className = 'files-dialog files-processor comp-dialog';
  dialog.setAttribute('aria-label', title);
  const hasOpen = e.sessions.some((s) => s.hasDocument);
  dialog.innerHTML = `<form method="dialog">
    <h2>${escapeXML(title)}</h2>
    <section class="processor-step"><h3><span>1</span>Source images</h3>
      <div class="processor-buttons"><button type="button" data-act="local">Add from this device…</button><button type="button" data-act="cloud">Add from Puter…</button>${hasOpen ? '<button type="button" data-act="open">Add open documents</button>' : ''}<button type="button" data-act="clear">Clear</button></div>
      <ul class="processor-list" aria-label="Source images"></ul>
    </section>
    ${settings}
    <p class="processor-status" aria-live="polite"></p>
    <div class="dialog-actions"><button type="button" data-act="cancel">Cancel</button><button type="submit" class="primary" disabled>${escapeXML(opts.submit ?? 'OK')}</button></div>
  </form>`;
  e.root.append(dialog);
  const form = dialog.querySelector('form')!;
  const list = dialog.querySelector<HTMLElement>('.processor-list')!;
  const status = dialog.querySelector<HTMLElement>('.processor-status')!;
  const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const listeners: (() => void)[] = [];
  let busy = false;
  const render = () => {
    list.innerHTML = inputs.length
      ? inputs.map((x, i) => `<li>${escapeXML(x.name)}<button type="button" class="icon-button" data-remove="${i}" aria-label="Remove ${escapeXML(x.name)}">×</button></li>`).join('')
      : `<li class="muted">Add ${min > 1 ? `at least ${min} images` : 'images'}</li>`;
    submit.disabled = busy || inputs.length < min;
    if (!busy) status.textContent = inputs.length ? `${inputs.length} image${inputs.length > 1 ? 's' : ''}${opts.max && inputs.length > opts.max ? ` (the first ${opts.max} are used)` : ''}` : '';
    for (const f of listeners) f();
  };
  const add = (items: Input[]) => {
    inputs.push(...items);
    render();
  };
  list.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-remove]');
    if (!b || busy) return;
    inputs.splice(Number(b.dataset.remove), 1);
    render();
  });
  let resolve!: (ok: boolean) => void;
  const result = new Promise<boolean>((r) => (resolve = r));
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    if (!busy) {
      close();
      resolve(false);
    }
  });
  dialog.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (!act || busy) return;
    if (act === 'cancel') {
      close();
      resolve(false);
    } else if (act === 'clear') {
      inputs.length = 0;
      render();
    } else if (act === 'local') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = rasterAccept;
      input.onchange = () => add(Array.from(input.files ?? []).map((f) => ({ name: f.name, blob: f })));
      input.click();
    } else if (act === 'cloud') {
      void pickCloudFiles(true, rasterAccept)
        .then((items) => add(items.map((it) => ({ name: it.name, load: () => it.read() }))))
        .catch((error) => (status.textContent = String(error instanceof Error ? error.message : error)));
    } else if (act === 'open') {
      add(e.sessions.filter((s) => s.hasDocument && !inputs.some((x) => x.session === s)).map((s) => ({ name: s.doc.name, session: s })));
    }
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy || inputs.length < min) return;
    resolve(true);
  });
  dialog.showModal();
  render();
  return {
    dialog,
    form,
    status,
    inputs,
    result,
    close,
    setBusy(b: boolean) {
      busy = b;
      for (const el of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) if (!el.closest('[data-act="cancel"]')) el.disabled = b;
      if (!b) render();
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };
}

export const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement;

/** Decoded 8-bit pixels of an input (open documents use their composite). */
export async function loadImage(e: Editor, input: Input): Promise<RGBA8> {
  if (input.session) {
    const s = input.session;
    return toRGBA8(await e.renderer.documentPixels({ ...s.doc, selection: null }, s.assets), s.doc.width, s.doc.height);
  }
  const blob = input.blob ?? (await input.load!());
  const d = await decodeFile(blob, input.name, { pages: 'first' });
  return d.image;
}

/** Copy an image whose buffer may be transferred to a worker. */
export const copyImage = (img: RGBA8): RGBA8 => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** Open a document built from layers as a new tab. */
export async function openDocument(e: Editor, name: string, width: number, height: number, build: (doc: PhotoDocument, s: DocumentSession) => Layer[] | Promise<Layer[]>, extra: Partial<PhotoDocument> = {}) {
  const s = e.newSession();
  e.session = s;
  await e.renderer?.settle();
  const doc: PhotoDocument = { ...s.doc, name, width, height, layers: [], selection: null, ...extra };
  doc.layers = await build(doc, s);
  s.history.reset(doc);
  s.hasDocument = true;
  s.saved = undefined;
  e.selectLayers(doc.layers.length ? [doc.layers.at(-1)!.id] : []);
  e.fit();
  e.update();
  return s;
}

/** One pixel layer showing an image at (x, y) of a new document. */
export function imageLayer(s: DocumentSession, doc: PhotoDocument, name: string, img: RGBA8, x = 0, y = 0) {
  return newPixelLayer(name, doc, gridFromImage(s.assets.tiles, img, x, y));
}
