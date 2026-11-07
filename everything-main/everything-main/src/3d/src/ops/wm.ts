// Window-manager style toggles and helpers.
import { app, registerOperators } from '../app/app';
import { activeTools } from '../app/prefs';
import { setActiveTool } from '../editors/view3d/toolbar';
import { modePie } from '../app/keys';
import { activeView3D } from '../editors/view3d/view3d';

registerOperators([
  {
    idname: 'wm.context_toggle_snap',
    label: 'Toggle Snap',
    exec: (ctx) => {
      ctx.doc.scene.tool_settings.use_snap = !ctx.doc.scene.tool_settings.use_snap;
    },
  },
  {
    idname: 'wm.context_toggle_proportional',
    label: 'Toggle Proportional Editing',
    exec: (ctx) => {
      const ts = ctx.doc.scene.tool_settings;
      if (ctx.doc.mode === 'OBJECT') ts.use_proportional_edit_objects = !ts.use_proportional_edit_objects;
      else ts.use_proportional_edit = !ts.use_proportional_edit;
    },
  },
  {
    idname: 'wm.tool_cycle_select',
    label: 'Cycle Select Tools',
    undo: false,
    poll: () => !!activeView3D() && app.doc.mode !== 'SCULPT' && !app.doc.mode.endsWith('PAINT'),
    exec: (ctx) => {
      const order = ['builtin.select', 'builtin.select_box', 'builtin.select_circle', 'builtin.select_lasso'];
      const cur = activeTools[ctx.doc.mode];
      const i = order.indexOf(cur);
      setActiveTool(order[(i + 1) % order.length]);
    },
  },
  {
    idname: 'view3d.pie_mode',
    label: 'Mode Pie',
    internal: true,
    undo: false,
    poll: () => !!app.activeObject,
    invoke: () => {
      modePie();
      return 'CANCELLED';
    },
  },
]);
