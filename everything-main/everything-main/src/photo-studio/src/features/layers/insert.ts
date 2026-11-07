import type { Editor } from '../../editor';
import type { Layer } from '../../model/document';

/** Add a layer above the selected layer (or at the top) as one undo step and select it. */
export function insertAboveSelection(e: Editor, l: Layer, label: string) {
  const anchor = e.selected;
  e.command(label, (d) => {
    const find = (layers: Layer[]): boolean => {
      const i = layers.findIndex((x) => x.id === anchor);
      if (i >= 0) {
        layers.splice(i + 1, 0, l);
        return true;
      }
      return layers.some((x) => find(x.children));
    };
    if (!anchor || !find(d.layers)) d.layers.push(l);
  });
  e.selected = l.id;
  e.update();
}
