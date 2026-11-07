// View > 32-Bit Preview Options: how a 32-bit document's linear values are
// shown on screen. The options are saved with the document and change only
// the presented canvas (see model/hdr-preview.ts and the color shaders).
import type { Editor } from '../../editor';
import type { PhotoDocument } from '../../model/document';
import { defaultHdrPreview, HDR_PREVIEW_METHODS, isIdentityHdrPreview, type HdrPreview, type HdrPreviewMethod } from '../../model/hdr-preview';
import { h, select, slider } from '../adjust/ui';
import { draggable } from '../effects/style-dialog';

let open = false;
export async function hdrPreviewDialog(e: Editor) {
  if (open || !e.hasDocument || e.doc.bitsPerChannel !== 32) return;
  open = true;
  const original = e.doc;
  const p: HdrPreview = { ...defaultHdrPreview(), ...(original.hdrPreview ?? {}) };
  const dialog = h('dialog', { class: 'hdr-preview-dialog', 'aria-label': '32-Bit Preview Options' });
  dialog.innerHTML = `<form method="dialog"><h2>32-Bit Preview Options</h2><p>Changes only how this document is shown; saved and exported pixels keep their values.</p><div class="hdr-fields"></div><div class="dialog-actions"><button type="button" data-reset>Reset</button><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">OK</button></div></form>`;
  e.root.append(dialog);
  const fields = dialog.querySelector<HTMLElement>('.hdr-fields')!;
  const preview = () => e.preview({ ...original, hdrPreview: { ...p } } as PhotoDocument);
  const render = () => {
    fields.replaceChildren(
      select('Method', HDR_PREVIEW_METHODS, p.method, (v) => {
        p.method = v as HdrPreviewMethod;
        render();
        preview();
      }).el,
      slider({ label: 'Exposure', min: -20, max: 20, step: 0.01, value: p.exposure, unit: 'stops', onInput: (v) => ((p.exposure = v), preview()) }).el,
      ...(p.method === 'exposure-gamma' ? [slider({ label: 'Gamma', min: 0.1, max: 9.99, step: 0.01, value: p.gamma, log: true, onInput: (v) => ((p.gamma = v), preview()) }).el] : []),
      ...(p.method === 'highlight-compression' ? [slider({ label: 'White point', min: 1, max: 100, step: 0.1, value: p.white, log: true, onInput: (v) => ((p.white = v), preview()) }).el] : []),
    );
  };
  render();
  const ok = await new Promise<boolean>((resolve) => {
    dialog.querySelector('[data-cancel]')!.addEventListener('click', () => resolve(false));
    dialog.querySelector('[data-reset]')!.addEventListener('click', () => {
      Object.assign(p, defaultHdrPreview());
      render();
      preview();
    });
    dialog.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      resolve(false);
    });
    dialog.querySelector('form')!.addEventListener('submit', (ev) => {
      ev.preventDefault();
      resolve(true);
    });
    dialog.showModal();
    draggable(dialog);
    preview();
  });
  dialog.close();
  dialog.remove();
  open = false;
  if (!ok) {
    e.preview(e.doc);
    return;
  }
  const same = JSON.stringify(original.hdrPreview ?? null) === JSON.stringify(isIdentityHdrPreview(p) ? null : p);
  if (same) {
    e.preview(e.doc);
    return;
  }
  e.command('32-Bit Preview Options', (d) => {
    if (isIdentityHdrPreview(p)) delete d.hdrPreview;
    else d.hdrPreview = { ...p };
  });
}
