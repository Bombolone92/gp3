import { PDFName, PDFHexString } from 'pdf-lib';

/** A small valid PDF outline whose depth exceeds typical JavaScript call stacks. */
export function addDeepOutline(doc, depth = 12000) {
  const root = doc.context.obj({ Type: 'Outlines', Count: depth });
  const rootRef = doc.context.register(root);
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  const nodes = [root];
  let parent = root,
    parentRef = rootRef;
  for (let i = 0; i < depth; i++) {
    const item = doc.context.obj({
      Title: PDFHexString.fromText(`Level ${i + 1}`),
      Parent: parentRef,
      ...(i + 1 < depth ? { Count: depth - i - 1 } : {}),
      Dest: [doc.getPage(0).ref, 'Fit'],
    });
    const ref = doc.context.register(item);
    parent.set(PDFName.of('First'), ref);
    parent.set(PDFName.of('Last'), ref);
    nodes.push(item);
    parent = item;
    parentRef = ref;
  }
  return nodes;
}
