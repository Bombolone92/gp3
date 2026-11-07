// Exporting "pages" (artboards, layer comps) to image files in a ZIP archive
// or to one PDF with a page per image. A page is a prepared document: an
// artboard cropped to its rectangle, or the canvas with a comp applied.
import type { Editor } from '../../editor';
import { cropDocument, type PhotoDocument, type Rect } from '../../model/document';
import type { ArtboardLayer } from '../../model/artboard';
import { buildPdf, splitRgba, type PdfImagePage } from '../../imaging/codecs/pdf';
import { deflate } from 'pako';
import { download } from '../../persistence/puter';
import { applyMatte, hexColor, type ExportFormat, type SourceImage } from '../files/encode';
import { bytesBlob, documentSource, effectiveSettings, encodeOffThread, exportContext, formatBytes, loadSettings } from '../files/pipeline';
import { prepareExport } from '../files/encode';
import { rgba16To8 } from '../files/png';
import { uniqueName, zipStore, type ZipEntry } from '../files/zip';
import { fieldChecked, fieldValue, modal } from '../files/ui';
import { saveToCloudFolder } from '../files/layers-export';

export type ExportPage = { name: string; doc: PhotoDocument };

/** One artboard alone on a canvas of its own size (other layers removed). */
export function artboardDocument(doc: PhotoDocument, a: ArtboardLayer): PhotoDocument {
  const page = structuredClone({ ...doc, layers: [a], selection: null, selectionMask: null, slices: undefined, layerComps: undefined, guides: undefined });
  page.name = a.name;
  cropDocument(page, a.artboard.rect);
  return page;
}
/** A document cropped to a rectangle (all layers kept). */
export function croppedDocument(doc: PhotoDocument, rect: Rect): PhotoDocument {
  const page = structuredClone({ ...doc, selection: null, selectionMask: null, slices: undefined, layerComps: undefined, guides: undefined });
  cropDocument(page, rect);
  return page;
}

const fileFormats: ExportFormat[] = ['png', 'jpeg', 'webp'];
const labels: Record<string, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };
type Options = { title: string; noun: string; pages: ExportPage[]; base: string };

/** Ask for format, quality and scale, then write the pages as image files. */
export async function exportPagesToFiles(e: Editor, opts: Options) {
  if (!opts.pages.length) throw new Error(`There are no ${opts.noun}s to export.`);
  const remembered = loadSettings();
  const start = fileFormats.includes(remembered.format) ? remembered.format : 'png';
  const result = await modal({
    title: opts.title,
    submit: 'Export',
    className: 'page-export-dialog',
    body: `<p>${opts.pages.length} ${opts.noun}${opts.pages.length === 1 ? '' : 's'} will be saved as separate images.</p>
      <label class="dialog-field">Format<select name="format">${fileFormats.map((f) => `<option value="${f}" ${f === start ? 'selected' : ''}>${labels[f]}</option>`).join('')}</select></label>
      <label class="dialog-field" data-lossy>Quality<span class="export-range"><input type="range" name="quality" min="1" max="100" step="1" value="${remembered.quality}"><output>${remembered.quality}</output></span></label>
      <label class="dialog-field">Scale<select name="scale">${[50, 100, 150, 200, 300].map((s) => `<option value="${s}" ${s === 100 ? 'selected' : ''}>${s}%</option>`).join('')}</select></label>
      <label class="dialog-field">File name prefix<input name="prefix" type="text" value="${opts.base.replace(/"/g, '&quot;')}_"></label>
      <label class="dialog-field checkbox-field">Keep transparency (PNG and WebP)<input name="transparency" type="checkbox" ${remembered.transparency ? 'checked' : ''}></label>
      <label class="dialog-field">Destination<select name="dest"><option value="zip">Download as ZIP archive</option><option value="puter">Save to a Puter folder…</option></select></label>`,
    bind: (dialog) => {
      const format = dialog.querySelector<HTMLSelectElement>('[name=format]')!;
      const quality = dialog.querySelector<HTMLInputElement>('[name=quality]')!;
      const sync = () => {
        dialog.querySelector<HTMLElement>('[data-lossy]')!.hidden = format.value === 'png';
        quality.nextElementSibling!.textContent = quality.value;
      };
      format.addEventListener('change', sync);
      quality.addEventListener('input', sync);
      sync();
    },
  });
  if (!result) return;
  const f = result.form;
  const format = fieldValue(f, 'format') as ExportFormat;
  const quality = Number(fieldValue(f, 'quality')) || 85;
  const scale = Number(fieldValue(f, 'scale')) || 100;
  const prefix = fieldValue(f, 'prefix');
  const transparency = fieldChecked(f, 'transparency');
  const dest = fieldValue(f, 'dest');
  result.close();
  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  let i = 0;
  for (const page of opts.pages) {
    e.message(`Exporting ${opts.noun} ${++i} of ${opts.pages.length}…`);
    const settings = effectiveSettings(page.doc, { ...remembered, format, quality, transparency, sizeMode: 'percent', scale, canvasWidth: 0, canvasHeight: 0 });
    const src = await documentSource(e, page.doc);
    const { bytes } = await encodeOffThread(src, settings, exportContext(page.doc));
    entries.push({ name: uniqueName(`${prefix}${page.name}.${format === 'jpeg' ? 'jpg' : format}`, used), data: bytes });
  }
  const mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  if (dest === 'puter') {
    saveToCloudFolder(e, entries.map((x) => ({ name: x.name, blob: bytesBlob(x.data, mime) })));
    return;
  }
  const zip = zipStore(entries);
  download(bytesBlob(zip, 'application/zip'), `${opts.base}-${opts.noun}s.zip`);
  e.message(`Exported ${entries.length} ${opts.noun}${entries.length === 1 ? '' : 's'} (${formatBytes(zip.length)})`);
}

/** JPEG bytes of prepared 8-bit pixels (already matted). */
async function jpegBytes(img: SourceImage, quality: number) {
  const data = img.data instanceof Uint16Array ? rgba16To8(img.data) : img.data;
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), img.width, img.height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Pixels per inch used to size PDF pages (72 when the document has none). */
export function documentPpi(doc: PhotoDocument) {
  const r = doc.resolution;
  if (!r) return 72;
  return r.horizontalResolutionUnit === 'PPCM' ? r.horizontalResolution * 2.54 : r.horizontalResolution;
}

/** Ask for image encoding and write one PDF with a page per document. */
export async function exportPagesToPdf(e: Editor, opts: Options) {
  if (!opts.pages.length) throw new Error(`There are no ${opts.noun}s to export.`);
  const ppi = documentPpi(e.doc);
  const result = await modal({
    title: opts.title,
    submit: 'Export PDF',
    className: 'page-export-dialog',
    body: `<p>${opts.pages.length} page${opts.pages.length === 1 ? '' : 's'}, sized at ${Math.round(ppi * 100) / 100} pixels per inch.</p>
      <label class="dialog-field">Encoding<select name="encoding"><option value="jpeg">JPEG (smaller)</option><option value="lossless">Lossless (keeps transparency)</option></select></label>
      <label class="dialog-field" data-jpeg>Quality<span class="export-range"><input type="range" name="quality" min="1" max="100" step="1" value="90"><output>90</output></span></label>
      <label class="dialog-field">Title<input name="title" type="text" value="${opts.base.replace(/"/g, '&quot;')}"></label>`,
    bind: (dialog) => {
      const encoding = dialog.querySelector<HTMLSelectElement>('[name=encoding]')!;
      const quality = dialog.querySelector<HTMLInputElement>('[name=quality]')!;
      const sync = () => {
        dialog.querySelector<HTMLElement>('[data-jpeg]')!.hidden = encoding.value !== 'jpeg';
        quality.nextElementSibling!.textContent = quality.value;
      };
      encoding.addEventListener('change', sync);
      quality.addEventListener('input', sync);
      sync();
    },
  });
  if (!result) return;
  const jpeg = fieldValue(result.form, 'encoding') === 'jpeg';
  const quality = Number(fieldValue(result.form, 'quality')) || 90;
  const title = fieldValue(result.form, 'title');
  result.close();
  const pdfPages: PdfImagePage[] = [];
  let i = 0;
  for (const page of opts.pages) {
    e.message(`Rendering page ${++i} of ${opts.pages.length}…`);
    const settings = effectiveSettings(page.doc, { ...loadSettings(), format: jpeg ? 'jpeg' : 'png', transparency: !jpeg, sizeMode: 'percent', scale: 100, canvasWidth: 0, canvasHeight: 0, depth: 8 });
    const img = prepareExport(await documentSource(e, page.doc), settings, exportContext(page.doc));
    if (jpeg) applyMatte(img.data, hexColor('#ffffff'));
    const size = { width: (img.width * 72) / ppi, height: (img.height * 72) / ppi };
    if (jpeg) pdfPages.push({ ...size, image: { width: img.width, height: img.height, jpeg: await jpegBytes(img, quality) } });
    else pdfPages.push({ ...size, image: { width: img.width, height: img.height, ...splitRgba(img.data instanceof Uint16Array ? rgba16To8(img.data) : img.data, img.width, img.height) } });
  }
  const pdf = buildPdf(pdfPages, { title, author: e.doc.info?.author, deflate: (d) => deflate(d) });
  download(bytesBlob(pdf, 'application/pdf'), `${opts.base}.pdf`);
  e.message(`PDF exported: ${pdfPages.length} page${pdfPages.length === 1 ? '' : 's'}, ${formatBytes(pdf.length)}`);
}
