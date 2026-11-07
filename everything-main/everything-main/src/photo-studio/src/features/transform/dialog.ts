// Custom modal dialogs on the shared #dialog element (wider than the
// generated form dialogs, with live controls).
import type { PhotoDocument, ResolutionInfo } from '../../model/document';
import { LENGTH_UNITS, ppcmToPpi, type LengthUnit } from './math';

export function openDialog(html: string, className: string, bind: (form: HTMLFormElement, close: (ok: boolean) => void) => void): Promise<boolean> {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
  return new Promise((resolve) => {
    dialog.innerHTML = html;
    dialog.classList.add('ts-dialog', className);
    const form = dialog.querySelector('form')!;
    let done = false;
    const close = (ok: boolean) => {
      if (done) return;
      done = true;
      dialog.classList.remove('ts-dialog', className);
      if (dialog.open) dialog.close();
      resolve(ok);
    };
    dialog.oncancel = () => close(false);
    dialog.onclose = () => close(false);
    form.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
    form.onsubmit = (ev) => {
      ev.preventDefault();
      close(true);
    };
    bind(form, close);
    dialog.showModal();
  });
}
/** Document resolution in pixels per inch (72 when unset). */
export function docPpi(doc: PhotoDocument) {
  const r = doc.resolution;
  if (!r || !(r.horizontalResolution > 0)) return 72;
  // Values are stored in their display unit (see File Info).
  return r.horizontalResolutionUnit === 'PPCM' ? ppcmToPpi(r.horizontalResolution) : r.horizontalResolution;
}
export function resolutionInfo(doc: PhotoDocument, ppi: number, unit: 'PPI' | 'PPCM'): ResolutionInfo {
  const value = unit === 'PPCM' ? ppi / 2.54 : ppi;
  const r = doc.resolution;
  return {
    horizontalResolution: value,
    horizontalResolutionUnit: unit,
    widthUnit: r?.widthUnit ?? (unit === 'PPCM' ? 'Centimeters' : 'Inches'),
    verticalResolution: value,
    verticalResolutionUnit: unit,
    heightUnit: r?.heightUnit ?? (unit === 'PPCM' ? 'Centimeters' : 'Inches'),
  };
}
export const unitOptions = (selected: LengthUnit, allowed: LengthUnit[] = LENGTH_UNITS.map(([u]) => u)) =>
  LENGTH_UNITS.filter(([u]) => allowed.includes(u))
    .map(([u, l]) => `<option value="${u}" ${u === selected ? 'selected' : ''}>${l}</option>`)
    .join('');
export const fmt = (v: number, unit: LengthUnit) => (unit === 'px' ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
