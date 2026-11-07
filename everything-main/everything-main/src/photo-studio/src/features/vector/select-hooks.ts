import type { Editor } from '../../editor';
import type { CanvasPointer } from '../../app/pointer';

// Other features can claim a press of the path selection tools first (the
// start and end markers of text on a path); `hover` returns a cursor.
export type SelectHook = {
  down: (e: Editor, p: CanvasPointer) => boolean;
  move: (e: Editor, p: CanvasPointer) => void;
  up: (e: Editor, p: CanvasPointer) => void | Promise<void>;
  hover?: (e: Editor, p: CanvasPointer) => string | undefined;
};
export const selectHooks: SelectHook[] = [];
