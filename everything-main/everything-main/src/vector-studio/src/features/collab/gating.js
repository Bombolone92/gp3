/**
 * View-only mode for viewers and commenters of a shared document. The
 * document itself refuses transactions (doc.readOnly), and before any
 * edit could start the interface turns editing off cleanly: commands that
 * change the document are disabled, only the Hand, Zoom and (for people
 * who may comment) Comment tools can be chosen, and panels that edit are
 * inert. Navigation, artboards, exporting a copy and comments keep working.
 */

/** Tools usable in a view-only document. */
export const VIEW_TOOLS = new Set(['hand', 'zoom', 'comment']);

/** Panels that stay usable (they do not change the document). */
export const VIEW_PANELS = new Set(['comments', 'navigator', 'info', 'documentInfo']);

const VIEW_PREFIXES = ['view.', 'window.', 'panel.', 'theme.', 'help.', 'comments.', 'collab.'];
const VIEW_COMMANDS = new Set([
  'file.new',
  'file.newFromTemplate',
  'file.newQuick',
  'file.open',
  'file.openLocal',
  'file.close',
  'file.closeAll',
  'file.save',
  'file.saveCopy',
  'file.invite',
  'file.shareReview',
  'file.exportAs',
  'file.exportScreens',
  'file.saveForWeb',
  'file.print',
  'file.documentInfo',
  'file.info',
  'edit.copy',
  'edit.preferences',
  'edit.keyboardShortcuts',
  'object.exitIsolation',
]);

export function allowedInViewOnly(id) {
  return VIEW_COMMANDS.has(id) || VIEW_PREFIXES.some((p) => id.startsWith(p));
}

/** Whether the active document is view only. */
export function viewOnly(app) {
  return Boolean(app.editor?.doc.readOnly);
}

export function installGating(app) {
  const commands = app.commands;
  const isEnabled = commands.isEnabled.bind(commands);
  commands.isEnabled = (id, args) => {
    const ed = args?.editor || app.editor;
    if (ed?.doc.readOnly && !allowedInViewOnly(id)) return false;
    return isEnabled(id, args);
  };

  const canUseTool = (id) => {
    if (!viewOnly(app)) return true;
    if (!VIEW_TOOLS.has(id)) return false;
    return id !== 'comment' || Boolean(app.editor?.collab?.canComment);
  };
  app.canUseTool = canUseTool;

  const setTool = app.setTool.bind(app);
  app.setTool = (id) => {
    if (!canUseTool(id)) {
      app.notify(app.editor?.collab?.canComment ? 'You can comment on this document but not edit it.' : 'This document is view only for you.', { polite: true });
      return;
    }
    setTool(id);
  };

  let last = null;
  const refresh = () => {
    const ro = viewOnly(app);
    app.root.classList.toggle('collab-view-only', ro);
    // Tool buttons: only usable groups stay enabled.
    for (const btn of app.toolbar?.el?.querySelectorAll('.tool-btn') || []) {
      if (!btn._ids) continue;
      const usable = !ro || btn._ids.some((id) => canUseTool(id));
      if (usable) btn.removeAttribute('aria-disabled');
      else btn.setAttribute('aria-disabled', 'true');
      btn.classList.toggle('collab-disabled', !usable);
    }
    for (const [id, p] of app.dock?.panels || []) {
      const off = ro && !VIEW_PANELS.has(id);
      p.el.inert = off;
      p.el.classList.toggle('collab-inert', off);
    }
    if (ro && !canUseTool(app.toolId)) setTool('hand');
    if (ro !== last) {
      last = ro;
      app.toolbar?.refreshTool?.();
    }
  };

  app.on('started', () => {
    // Holding Cmd/Ctrl must not bring up the Selection tool in a view-only document.
    const input = app.input;
    const setTemp = input.setTempTool.bind(input);
    input.setTempTool = (tool) => {
      if (tool && viewOnly(app) && !VIEW_TOOLS.has(tool.id)) return;
      setTemp(tool);
    };
    refresh();
  });
  app.on('active-editor', refresh);
  app.collab?.on('role', refresh);
  return { refresh };
}
