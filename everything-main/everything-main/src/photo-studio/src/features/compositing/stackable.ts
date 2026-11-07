import type { Editor } from '../../editor';
import type { Layer } from '../../model/document';

// Layer kinds Auto-Align and Auto-Blend work on.
export const ALIGNABLE = new Set<Layer['kind']>(['pixel', 'image']);
/** Auto-Align / Auto-Blend need two or more pixel or embedded layers selected. */
export const canStack = (e: Editor) => e.hasDocument && e.selectedLayers.filter((l) => ALIGNABLE.has(l.kind)).length >= 2;
