import type { Editor } from '../../editor';
import { contentsOf, stackModes, type StackMode } from '../../model/embedded';

export const stackLabel = (mode: StackMode | undefined) => stackModes.find(([m]) => m === (mode ?? 'none'))![1];
/** Contents the selected layer can stack (a nested document of layers). */
export function stackable(e: Editor) {
  const l = e.selectedIds.size === 1 ? e.layer : undefined;
  const c = contentsOf(e.doc, l);
  return c?.project ? c : undefined;
}

