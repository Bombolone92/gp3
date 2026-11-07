// File → Place Embedded and dropping files on the canvas: every placed file
// becomes an embedded object, fitted to the canvas.
import type { Editor } from '../../editor';
import { contentsFromFile, fittedTransform, insertInstance, instanceLayer } from './contents';

export async function placeEmbedded(e: Editor, file: Blob, name: string) {
  const c = await contentsFromFile(e, e.doc, e.assets, file, name);
  insertInstance(e, instanceLayer(c, c.name, fittedTransform(e.doc, c.width, c.height)), c, 'Place Embedded');
  e.message(`Placed ${name} as an embedded object.`);
}
