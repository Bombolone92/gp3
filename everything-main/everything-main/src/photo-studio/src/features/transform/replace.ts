import type { Layer, PhotoDocument } from '../../model/document';

/** A document with one layer (found at any depth) replaced. */
export function replaceLayer(doc: PhotoDocument, id: string, next: Layer): PhotoDocument {
  const walk = (layers: Layer[]): Layer[] => layers.map((l) => (l.id === id ? next : l.children.length ? { ...l, children: walk(l.children) } : l));
  return { ...doc, layers: walk(doc.layers) };
}
