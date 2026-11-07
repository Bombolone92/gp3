import { readContextualFlag } from './docx-contextual-spacing.js';
export function readCapitalization(rPr) {
  const caps = readContextualFlag(rPr, 'caps'), small = readContextualFlag(rPr, 'smallCaps');
  // Existing documents carry simultaneous declarations despite the prose exclusivity
  // constraint. Keep both flags for inheritance and character-style toggles.
  if (caps !== undefined && small !== undefined) return { capitalization: caps ? small ? 'bothCapsOn' : 'capsSmallCapsOff' : small ? 'smallCapsCapsOff' : 'bothCapsOff' };
  return caps !== undefined ? { capitalization: caps ? 'caps' : 'capsOff' } : small !== undefined ? { capitalization: small ? 'smallCaps' : 'smallCapsOff' } : {};
}
