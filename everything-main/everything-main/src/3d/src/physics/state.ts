// Module state shared by the physics systems: the document being evaluated (for
// modifier dependency callbacks that only receive the modifier).
import type { DocumentData } from '../data/types';

let current: DocumentData | null = null;

export function physicsDoc(): DocumentData | null {
  return current;
}

export function setPhysicsDoc(doc: DocumentData) {
  current = doc;
}
