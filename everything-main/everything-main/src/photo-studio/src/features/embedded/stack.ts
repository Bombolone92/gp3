// Stack modes on embedded objects, and File → Scripts → Load Files into Stack.
import type { Editor } from '../../editor';
import { newDocument, type PhotoDocument } from '../../model/document';
import { deserialize } from '../../model/serialization';
import { stackModes, type StackMode } from '../../model/embedded';
import { newPixelLayer } from '../../model/pixel-layer';
import { gridFromImage } from '../../model/tiles';
import { readRgbProfile } from '../../color/profile';
import { formDialog } from '../../ui/dialog';
import type { RGBA8 } from '../../imaging/types';
import { convertToSrgb, documentProfile } from '../files/color';
import { decodeFile } from '../files/open';
import { toRGBA8 } from '../pixels';
import { contentsFromDocument, setContents } from './contents';
import { convertToEmbedded, fileAccept, pickLocalFiles } from './convert';
import { documentSamples } from './render';
import { stackLabel, stackable } from './stack-mode';

export { stackLabel, stackable } from './stack-mode';

/** Recompute the selected object's content as a per-pixel statistic of its
 * layers (or its normal composite for "none"). */
export async function setStackMode(e: Editor, mode: StackMode) {
  const c = stackable(e);
  if (!c) {
    e.message('Stack modes combine the layers inside an embedded object. Convert several layers to an embedded object first.');
    return;
  }
  if ((c.stack ?? 'none') === mode) return;
  const loaded = await deserialize(e.assets.blob(c.project!));
  try {
    if (mode !== 'none' && loaded.document.layers.filter((l) => l.visible).length < 2) e.message('Stack modes need at least two visible layers in the contents.');
    const next = await contentsFromDocument(e, e.doc, e.assets, loaded.document, loaded.assets, { name: c.name, stack: mode, projectId: c.project, id: c.id });
    const rest = { ...c };
    delete rest.stack;
    e.command(`Stack Mode: ${stackLabel(mode)}`, (d) => setContents(d, { ...rest, ...next }));
  } finally {
    loaded.assets.clear();
  }
}

/** Flattened 8-bit sRGB pixels of any file the editor opens. */
export async function flattenFile(e: Editor, file: Blob, name: string): Promise<RGBA8> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.photo') || /\.ps[db]$/.test(lower)) {
    const loaded = lower.endsWith('.photo') ? await deserialize(file) : await (await import('../../model/psd')).openPsd(file, name, e.engine);
    try {
      const s = await documentSamples(e, loaded.document, loaded.assets);
      const img = toRGBA8(s.data, s.width, s.height);
      const data = new Uint8ClampedArray(img.data);
      const profile = documentProfile(loaded.document);
      if (profile && (loaded.document.bitsPerChannel ?? 8) !== 32) convertToSrgb(data, profile);
      return { width: img.width, height: img.height, data };
    } finally {
      loaded.assets.clear();
    }
  }
  const d = await decodeFile(file, name, { pages: 'first' });
  if (d.icc)
    try {
      convertToSrgb(d.image.data, readRgbProfile(d.icc));
    } catch {
      /* Shown as sRGB, as when opening the file. */
    }
  return d.image;
}

/** File → Scripts → Load Files into Stack: one document with a layer per
 * file, optionally combined into an embedded object with a stack mode. */
export async function loadFilesIntoStack(e: Editor, files?: File[]) {
  files ??= await pickLocalFiles(fileAccept(), true);
  if (!files.length) return;
  const list = files.slice(0, 6).map((f) => f.name).join(', ') + (files.length > 6 ? ` and ${files.length - 6} more` : '');
  const v = await formDialog(
    'Load Files into Stack',
    [
      { name: 'embed', label: 'Convert the layers to an embedded object', type: 'checkbox', value: files.length > 1 ? 'yes' : 'no' },
      { name: 'stack', label: 'Stack mode (embedded object only)', type: 'select', value: 'median', options: stackModes },
    ],
    'Load',
    `${files.length} file${files.length === 1 ? '' : 's'}: ${list}. Each file becomes a layer, centered on the largest.`,
  );
  if (!v) return;
  const images: { name: string; image: RGBA8 }[] = [];
  for (const f of files) images.push({ name: f.name.replace(/\.[^.]+$/, ''), image: await flattenFile(e, f, f.name) });
  await stackImages(e, images, { embed: v.embed === 'yes', mode: v.stack as StackMode });
  e.message(`Loaded ${files.length} file${files.length === 1 ? '' : 's'} into a stack${v.embed === 'yes' && v.stack !== 'none' ? ` (${stackLabel(v.stack as StackMode)})` : ''}.`);
}

/** A new document with one layer per image, centered on the largest; then
 * optionally aligned and combined into an embedded object with a stack mode
 * (File → Scripts → Load Files into Stack and Statistics). */
export async function stackImages(e: Editor, images: { name: string; image: RGBA8 }[], o: { embed: boolean; mode: StackMode; align?: boolean; name?: string }) {
  const width = Math.max(...images.map((i) => i.image.width)),
    height = Math.max(...images.map((i) => i.image.height));
  const s = e.sessionForOpen();
  await e.renderer?.settle();
  const doc: PhotoDocument = { ...newDocument(width, height, o.name ?? 'Stack'), layers: [] };
  for (const { name, image } of images)
    doc.layers.push(newPixelLayer(name, doc, gridFromImage(s.assets.tiles, image, Math.round((width - image.width) / 2), Math.round((height - image.height) / 2))));
  s.history.reset(doc);
  s.hasDocument = true;
  s.storage.reset();
  s.saved = s.doc;
  s.fileName = `${o.name ?? 'Stack'}.photo`;
  e.selectLayers(doc.layers.map((l) => l.id));
  e.fit();
  e.update();
  if (o.align && images.length > 1) {
    const { autoAlign } = await import('../compositing/layers');
    await autoAlign(e, { params: { projection: 'auto' } });
    e.selectLayers(e.doc.layers.map((l) => l.id));
  }
  if (o.embed) {
    await convertToEmbedded(e);
    if (o.mode !== 'none') await setStackMode(e, o.mode);
  }
}
