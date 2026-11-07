import type { Editor } from '../../editor';
import type { VectorMask } from '../../model/vector';
import { previewTarget, type PathTarget } from './state';
import { setDraft } from './overlay';

/** Live preview of a tool's uncommitted edit: the overlay shows the draft
 * knots and a shape layer re-renders with them. */
export function previewEdit(e: Editor, t: PathTarget | undefined, mask: VectorMask) {
  setDraft(t, mask);
  if (t?.kind === 'shape' || t?.kind === 'text') e.preview(previewTarget(e, t, mask));
  e.overlay();
}
export function endPreview(e: Editor) {
  setDraft(undefined, undefined);
  e.preview(e.doc);
  e.overlay();
}
