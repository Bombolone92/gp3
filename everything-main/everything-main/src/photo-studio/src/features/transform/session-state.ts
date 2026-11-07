// The running advanced transform session and what Transform Again repeats.
// Menus and the Free Transform hooks read this at any time; the session
// implementation (session.ts) loads when a session first starts.
import type { PhotoDocument } from '../../model/document';
import { selectedRoots } from '../../model/layers';
import { selectionFrame } from '../../model/transform';
import type { Mat3 } from '../../imaging/filters/warp';
import type { MeshGrid } from '../../imaging/filters/mesh';
import type { TransformSession } from './session';

export const SESSION_TOOL = 'transform-session';
/** What Transform Again repeats: a document-space matrix and, for warps, the
 * mesh relative to the transformed frame (unit square coordinates). */
export type LastTransform = { matrix: Mat3; unitMesh?: MeshGrid };

let active: TransformSession | undefined;
export const currentSession = () => active;
export function setCurrentSession(s: TransformSession | undefined) {
  active = s;
}
let last: LastTransform | undefined;
export const lastTransform = () => last;
export function recordTransform(t: LastTransform) {
  last = t;
}
/** Selected layers resolved against a document (for recording Free Transform). */
export function selectionFrameOf(doc: PhotoDocument, ids: ReadonlySet<string>) {
  return selectionFrame(selectedRoots(doc.layers, ids));
}
