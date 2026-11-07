/**
 * Shared state between the Mask panel (details) and the on-canvas mask
 * editor (player): which clip's masks are being edited, the selected mask,
 * the selected pen point, pen drawing and brush settings. UI state only; the
 * masks themselves live in the project.
 *
 * Mask editing is active while the Mask panel is on screen for the selected
 * clip and editing on the canvas is not switched off.
 *
 * Events: change (anything above changed, redraw the overlay).
 */
import { Emitter } from '../lib/emitter.js';

class MaskEditState extends Emitter {
  constructor() {
    super();
    this.panel = null; // element of the open Mask panel
    this.clipId = null;
    this.index = 0;
    this.point = -1; // selected pen point
    this.drawing = false; // adding pen points by clicking
    this.onCanvas = true;
    this.brush = { size: 0.06, erase: false };
  }

  /** The Mask panel for clipId is now shown in el. */
  open(el, clipId) {
    if (this.clipId !== clipId) {
      this.index = 0;
      this.point = -1;
      this.drawing = false;
    }
    this.panel = el;
    this.clipId = clipId;
    this.emit('change');
  }

  /** Whether the masks of clipId are edited on the canvas right now. */
  active(clipId) {
    return Boolean(this.onCanvas && this.panel?.isConnected && this.clipId && this.clipId === clipId);
  }

  set(patch) {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if (this[k] !== v) {
        this[k] = v;
        changed = true;
      }
    }
    if (changed) this.emit('change');
  }

  /** Something around the panel changed (tab switch): let the overlay re-check. */
  refresh() {
    this.emit('change');
  }
}

export const maskEdit = new MaskEditState();
