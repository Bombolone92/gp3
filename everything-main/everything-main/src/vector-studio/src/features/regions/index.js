/**
 * Paint Regions: Object > Paint Regions > Make / Merge / Release / Gap
 * Options... / Expand, View > Show Paint Region Gaps, the Paint Bucket and
 * Region Selection tools, panel paint routed to selected regions, and the
 * on-canvas gap preview. Model in regions-model.js, geometry in planar.js.
 */
import './styles.css';
import { h } from '../../lib/dom.js';
import { paintHooks } from '../../ops/paint-ops.js';
import { registerIcons } from '../../ui/icons.js';
import { FEATURE_ICONS } from '../repeat/icons.js';
import { overlayHooks } from '../../render/overlay.js';
import { PropertiesPanel } from '../../ui/panels/properties.js';
import { expandLive } from '../../model/live.js';
import { isRegions, makeRegions, mergeIntoRegions, releaseRegions, regionMap, regionPaints, paintFaces, paintEdges, regionSource, DEFAULT_GAPS } from './regions-model.js';
import { PaintBucketTool, RegionSelectTool, resolvedRegionSelection, setRegionSelection, highlight } from './tools.js';
import { gapOptionsDialog, selectedRegions, gapDefaults } from './gap-dialog.js';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Faces and edges a panel's paint goes to: the region selection, or every region of selected groups. */
function paintScope(editor) {
  const rs = resolvedRegionSelection(editor);
  if (rs) return [{ group: rs.group, faces: rs.faces, edges: rs.edges, map: rs.map }];
  const top = editor.topSelection();
  if (!top.length) return null;
  const groups = top.map((id) => editor.doc.get(id));
  if (!groups.every(isRegions)) return null;
  return groups.map((g) => {
    const map = regionMap(editor.doc, g);
    return { group: g, faces: map.faces, edges: map.edges.filter((e) => e.kind !== 'gap'), map };
  });
}

function installPaintHooks() {
  const prevApply = paintHooks.applyStyle;
  paintHooks.applyStyle = (editor, patch, label, coalesce) => {
    const scope = editor && ('fill' in patch || 'stroke' in patch || 'strokeWidth' in patch) ? paintScope(editor) : null;
    if (!scope) return prevApply ? prevApply(editor, patch, label, coalesce) : false;
    const doc = editor.doc;
    doc.transact(
      label,
      () => {
        for (const s of scope) {
          if ('fill' in patch && s.faces.length) paintFaces(doc, s.group.id, s.faces, patch.fill);
          if (('stroke' in patch || 'strokeWidth' in patch) && s.edges.length) {
            const { strokes } = regionPaints(doc, doc.get(s.group.id));
            // A width change keeps each edge's color; a color change keeps the width (1 pt for unstroked edges).
            const groupsByStyle = new Map();
            for (const e of s.edges) {
              const cur = strokes[e.id];
              const stroke = 'stroke' in patch ? patch.stroke : cur?.stroke ?? editor.style.stroke;
              const strokeWidth = 'strokeWidth' in patch ? patch.strokeWidth : cur?.strokeWidth || editor.style.strokeWidth || 1;
              const key = JSON.stringify([stroke, strokeWidth]);
              if (!groupsByStyle.has(key)) groupsByStyle.set(key, { style: { stroke, strokeWidth }, edges: [] });
              groupsByStyle.get(key).edges.push(e);
            }
            for (const { style, edges } of groupsByStyle.values()) paintEdges(doc, s.group.id, edges, style);
          }
        }
      },
      { coalesce },
    );
    editor.setStyle(patch);
    return true;
  };
  const prevCommon = paintHooks.commonStyle;
  paintHooks.commonStyle = (editor, key) => {
    if (editor && ['fill', 'stroke', 'strokeWidth'].includes(key)) {
      const scope = paintScope(editor);
      if (scope) {
        const values = [];
        for (const s of scope) {
          const { fills, strokes } = regionPaints(editor.doc, editor.doc.get(s.group.id));
          if (key === 'fill') for (const f of s.faces) values.push(fills[f.id] ?? null);
          else for (const e of s.edges) values.push(key === 'stroke' ? strokes[e.id]?.stroke ?? null : strokes[e.id]?.strokeWidth ?? 0);
        }
        if (values.length) return values.every((v) => same(v, values[0])) ? values[0] : 'mixed';
      }
    }
    return prevCommon ? prevCommon(editor, key) : undefined;
  };
}

/** Gap preview and the region selection, drawn over the artwork. */
function drawRegionsOverlay(ctx, editor, colors) {
  const doc = editor.doc;
  const rs = resolvedRegionSelection(editor);
  if (rs) {
    const accent = colors.selection || '#4f80ff';
    ctx.save();
    for (const f of rs.faces) highlight(ctx, editor, rs.map, { face: f }, accent, 1.5, hatch(ctx, accent));
    for (const e of rs.edges) highlight(ctx, editor, rs.map, { edge: e }, accent, 4);
    ctx.restore();
  }
  if (!editor.viewOptions.paintRegionsGaps) return;
  const groups = new Set(selectedRegions(editor));
  const tool = editor.tool;
  if (tool?.hot?.group) groups.add(tool.hot.group.id);
  for (const id of groups) {
    const g = doc.get(id);
    if (!isRegions(g)) continue;
    const map = regionMap(doc, g);
    const color = g.live.gaps?.color || DEFAULT_GAPS.color;
    for (const e of map.edges) if (e.kind === 'gap') highlight(ctx, editor, map, { edge: e }, color, 3);
  }
}

const hatchCache = new Map();
/** A diagonal hatch pattern for selected regions. */
function hatch(ctx, color) {
  if (hatchCache.has(color)) return hatchCache.get(color);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  x.strokeStyle = color;
  x.globalAlpha = 0.55;
  x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(0, 8);
  x.lineTo(8, 0);
  x.stroke();
  const p = ctx.createPattern?.(c, 'repeat') || null;
  hatchCache.set(color, p);
  return p;
}

function registerCommands(app) {
  const regionsOf = (a) => selectedRegions(a.editor);
  app.commands.register([
    {
      id: 'paintRegions.make',
      label: 'Make',
      shortcut: 'Alt+Mod+X',
      enabled: (a) => Boolean(a.editor?.topSelection().some((id) => regionSource(a.editor.doc, a.editor.doc.get(id)) && !isRegions(a.editor.doc.get(id)))),
      run: (a) => {
        const ed = a.editor;
        let gid = null;
        ed.doc.transact('Make Paint Regions', () => {
          gid = makeRegions(ed.doc, ed.topSelection(), gapDefaults(a));
        });
        if (gid) ed.select([gid]);
      },
    },
    {
      id: 'paintRegions.merge',
      label: 'Merge',
      enabled: (a) => {
        const ed = a.editor;
        if (!ed) return false;
        const top = ed.topSelection().map((id) => ed.doc.get(id));
        return top.filter(isRegions).length === 1 && top.some((n) => !isRegions(n) && regionSource(ed.doc, n));
      },
      run: (a) => {
        const ed = a.editor;
        const top = ed.topSelection();
        const gid = top.find((id) => isRegions(ed.doc.get(id)));
        ed.doc.transact('Merge Paint Regions', () => mergeIntoRegions(ed.doc, gid, top.filter((id) => id !== gid)));
        ed.select([gid]);
      },
    },
    {
      id: 'paintRegions.release',
      label: 'Release',
      enabled: (a) => regionsOf(a).length > 0,
      run: (a) => {
        const ed = a.editor;
        const ids = regionsOf(a);
        if (ed.isolation && ids.includes(ed.isolation)) a.commands.run('object.exitIsolation');
        const out = [];
        ed.doc.transact('Release Paint Regions', () => ids.forEach((id) => out.push(...releaseRegions(ed.doc, id))));
        setRegionSelection(ed, null);
        ed.select(out);
      },
    },
    { id: 'paintRegions.gapOptions', label: 'Gap Options...', enabled: (a) => Boolean(a.editor), run: (a) => gapOptionsDialog(a) },
    {
      id: 'paintRegions.expand',
      label: 'Expand',
      enabled: (a) => regionsOf(a).length > 0,
      run: (a) => {
        const ed = a.editor;
        const ids = regionsOf(a);
        if (ed.isolation && ids.includes(ed.isolation)) a.commands.run('object.exitIsolation');
        const out = [];
        ed.doc.transact('Expand Paint Regions', () => ids.forEach((id) => out.push(expandLive(ed.doc, id)?.id)));
        setRegionSelection(ed, null);
        ed.select(out.filter(Boolean));
      },
    },
    {
      id: 'view.paintRegionGaps',
      label: (a) => (a.editor?.viewOptions.paintRegionsGaps ? 'Hide Paint Region Gaps' : 'Show Paint Region Gaps'),
      enabled: (a) => Boolean(a.editor),
      checked: (a) => Boolean(a.editor?.viewOptions.paintRegionsGaps),
      run: (a) => a.editor.setViewOption('paintRegionsGaps', !a.editor.viewOptions.paintRegionsGaps),
    },
  ]);
  // Delete with regions selected removes their paint instead of deleting the group.
  const clear = app.commands.get('edit.clear');
  if (clear) {
    const run = clear.run;
    const enabled = clear.enabled;
    clear.enabled = (a, args) => Boolean(resolvedRegionSelection(a.editor)) || (enabled ? enabled(a, args) : true);
    clear.run = (a, args) => {
      const rs = resolvedRegionSelection(a.editor);
      if (!rs) return run(a, args);
      const doc = a.editor.doc;
      doc.transact('Clear Paint', () => {
        if (rs.faces.length) paintFaces(doc, rs.group.id, rs.faces, null);
        if (rs.edges.length) paintEdges(doc, rs.group.id, rs.edges, { stroke: null });
      });
      return true;
    };
  }
}

function regionsSection(app) {
  const one = (ed) => {
    const top = ed?.topSelection() || [];
    return top.length === 1 && isRegions(ed.doc.get(top[0])) ? ed.doc.get(top[0]) : null;
  };
  return {
    id: 'paintRegions',
    title: 'Paint Regions',
    when: (ed) => Boolean(one(ed)),
    build() {
      const info = h('p.form-help');
      const btn = (label, cmd) => h('button.btn', { type: 'button', onclick: () => app.commands.run(cmd) }, label);
      const tools = h(
        'div.quick-actions',
        h('button.btn', { type: 'button', onclick: () => app.setTool('paint-bucket') }, 'Paint Bucket'),
        h('button.btn', { type: 'button', onclick: () => app.setTool('region-select') }, 'Select Regions'),
        btn('Gap Options…', 'paintRegions.gapOptions'),
        btn('Expand', 'paintRegions.expand'),
        btn('Release', 'paintRegions.release'),
      );
      return {
        el: h('div.rep-section', info, tools),
        refresh() {
          const g = one(app.editor);
          if (!g) return;
          const map = regionMap(app.editor.doc, g);
          const { fills } = regionPaints(app.editor.doc, g);
          const painted = fills.filter(Boolean).length;
          info.textContent = `${map.faces.length} regions (${painted} painted), ${map.edges.filter((e) => e.kind !== 'gap').length} edges${map.gaps.length ? `, ${map.gaps.length} gaps closed` : ''}`;
        },
      };
    },
  };
}

export function install(app) {
  registerIcons(FEATURE_ICONS);
  app.registerTool(PaintBucketTool);
  app.registerTool(RegionSelectTool);
  registerCommands(app);
  installPaintHooks();
  overlayHooks.add(drawRegionsOverlay);
  if (!PropertiesPanel.extraSections.some((s) => s.id === 'paintRegions')) PropertiesPanel.extraSections.push(regionsSection(app));
  // A region selection lasts until the object selection changes to something else.
  const watch = (ed) => {
    if (!ed || ed.regionsWatched) return;
    ed.regionsWatched = true;
    ed.on('selection', () => {
      if (ed.regionSelectionGuard || !ed.regionSelection) return;
      const top = ed.topSelection();
      if (top.length !== 1 || top[0] !== ed.regionSelection.group) ed.regionSelection = null;
    });
  };
  app.on('active-editor', watch);
  watch(app.editor);
}
