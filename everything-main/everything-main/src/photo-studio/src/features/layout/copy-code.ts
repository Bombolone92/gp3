import type { Editor } from '../../editor';
import type { Layer } from '../../model/document';
import { escapeXML } from '../../model/assets';
import { documentSource } from '../files/pipeline';
import { convertToSrgb, documentProfile } from '../files/color';
import { encodePng, rgba16To8 } from '../files/png';
import { modal } from '../files/ui';
import { formatCss, selectionCss, selectionSvg, type RasterLayer } from './code-export';

// Layer → Copy CSS / Copy SVG put code for the selected layers on the
// clipboard, or show it in a dialog when the clipboard is unavailable.

/** One layer rendered alone, cropped to its visible pixels, as sRGB PNG. */
function rasterizer(e: Editor): RasterLayer {
  const doc = e.doc;
  const profile = documentProfile(doc);
  return async (l: Layer) => {
    const src = await documentSource(e, { ...doc, layers: [{ ...l, visible: true, opacity: 1, blend: l.blend === 'pass through' ? l.blend : 'normal', clipped: false }] });
    const { width: w, height: h } = src;
    let data = src.data instanceof Uint16Array ? rgba16To8(src.data) : src.data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (data[(y * w + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
    if (x1 < 0) return;
    const cw = x1 - x0 + 1,
      ch = y1 - y0 + 1;
    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * cw * 4);
    data = profile ? convertToSrgb(out, profile) : out;
    return { x: x0, y: y0, width: cw, height: ch, png: encodePng({ width: cw, height: ch, data, channels: 4 }, { level: 9 }) };
  };
}

/** Put text on the clipboard. The clipboard item is created while the menu
 * click still counts as user activation, with the text still being built. */
async function deliver(e: Editor, build: Promise<{ text: string; summary: string }>, kind: string) {
  let written: Promise<void> | undefined;
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write)
      written = navigator.clipboard.write([new ClipboardItem({ 'text/plain': build.then(({ text }) => new Blob([text], { type: 'text/plain' })) })]);
  } catch {
    written = undefined;
  }
  // Failures are handled below; keep an early rejection from going unobserved.
  written?.catch(() => {});
  const { text, summary } = await build;
  try {
    if (written) await written;
    else await navigator.clipboard.writeText(text);
    e.message(`${kind} copied to the clipboard (${summary})`);
    return;
  } catch {
    // Some browsers refuse clipboard writes (permissions, insecure origin).
  }
  e.release();
  const result = await modal({
    title: `Copy ${kind}`,
    submit: 'Copy',
    className: 'copy-code-dialog',
    body: `<p>The clipboard did not accept the ${escapeXML(kind)}. Copy it from here.</p><textarea name="code" readonly rows="16" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:12px;white-space:pre">${escapeXML(text)}</textarea>`,
    bind: (dialog) => dialog.querySelector<HTMLTextAreaElement>('textarea')!.select(),
  });
  if (!result) return;
  // A click inside the dialog is a fresh user activation for the legacy copy.
  result.form.querySelector<HTMLTextAreaElement>('textarea')!.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  result.close();
  e.message(copied ? `${kind} copied to the clipboard (${summary})` : `Select the ${kind} and copy it with the keyboard.`);
}

/** Layer → Copy CSS. */
export async function copyCss(e: Editor) {
  const rules = selectionCss(e.doc, e.selectedLayers);
  if (!rules.length) throw new Error('The selected layers have nothing to describe in CSS.');
  await deliver(e, Promise.resolve({ text: formatCss(rules), summary: `${rules.length} rule${rules.length === 1 ? '' : 's'}` }), 'CSS');
}
/** Layer → Copy SVG. */
export async function copySvg(e: Editor) {
  const roots = e.selectedLayers;
  const build = selectionSvg(e.doc, roots, rasterizer(e)).then((text) => ({
    text,
    summary: `${roots.length} layer${roots.length === 1 ? '' : 's'}, ${Math.max(1, Math.round(text.length / 1024))} KB`,
  }));
  await deliver(e, build, 'SVG');
}
