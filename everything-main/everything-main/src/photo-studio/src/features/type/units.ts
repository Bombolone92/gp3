// Preferences → Units & Rulers → Type: sizes are stored in points and shown
// in points, pixels (at the document resolution) or millimeters.
import type { Editor } from '../../editor';
import { documentPpi } from '../../model/text-layer';

/** Display factor (shown = points × k) and suffix of the type unit. */
export function typeUnit(e: Editor): { k: number; suffix: string; name: string } {
  const u = e.preferences.typeUnits;
  if (u === 'px') return { k: documentPpi(e.doc) / 72, suffix: 'px', name: 'pixels' };
  if (u === 'mm') return { k: 25.4 / 72, suffix: 'mm', name: 'millimeters' };
  return { k: 1, suffix: 'pt', name: 'points' };
}
