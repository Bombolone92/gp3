// Keyboard routing. Order: the active tool (Space, Tab, Backspace while
// placing), then shortcuts, then menu accelerators: a plain letter opens the
// menu with that accelerator so 'P' then 'W' runs Place > Wire.

import { comboOf, isTypingTarget } from './commands.js';
import { dialogOpen } from '../ui/dialog.js';
import { isMenuOpen } from '../ui/menu.js';

// Shortcuts that still work while a text field has focus.
const IN_INPUT = new Set(['Mod+S', 'Mod+Shift+S', 'Mod+O', 'Mod+K', 'F1']);

export class KeyHandler {
  constructor(app) {
    this.app = app;
    document.addEventListener('keydown', (e) => this.handle(e));
  }

  /** True when keyboard input should go to the design canvas. */
  editorFocused(e) {
    const ed = this.app.activeEditor;
    if (!ed) return false;
    const t = e.target;
    return t === document.body || t === ed.canvas || ed.el.contains(t) && !isTypingTarget(t) && !t.closest?.('.layer-tabs');
  }

  handle(e) {
    if (e.defaultPrevented || dialogOpen() || isMenuOpen()) return;
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    const combo = comboOf(e);
    const typing = isTypingTarget(e.target);
    if (typing && !IN_INPUT.has(combo)) return;
    const ed = this.app.activeEditor;
    const onCanvas = this.editorFocused(e);
    if (onCanvas && ed?.tool?.key?.(e, combo)) {
      e.preventDefault();
      ed.updateHint();
      ed.requestRender(true);
      return;
    }
    const cmd = this.app.commands.byShortcut(combo);
    if (cmd) {
      // Canvas-specific single keys only act when the canvas has focus.
      const plain = !/^(Mod|Alt|Ctrl|Meta)\+/.test(combo) && !/^F\d+$/.test(combo);
      if (plain && !onCanvas && !cmd.anywhere) return;
      e.preventDefault();
      this.app.commands.run(cmd.id);
      return;
    }
    if (onCanvas && /^[A-Z]$/.test(combo) && this.app.menubar.openByAccel(combo)) {
      e.preventDefault();
    }
  }
}
