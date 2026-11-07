/**
 * Object > Graph dialogs: Type (graph type, style, per-type options, value
 * and category axes, with a live preview), Design (the document's graph
 * designs), Column (column designs per series) and Marker (marker designs).
 */
import { h } from '../../lib/dom.js';
import { icon } from '../../ui/icons.js';
import { GRAPH_TYPES, TYPE_LABELS, graphOptions } from './graph-math.js';
import { selectedGraphs, selectedSeries, updateGraph, setSeriesOption, addDesign, nextDesignName, renameDesign, deleteDesign, pasteDesign, unusedDesigns } from './graph-ops.js';
import { graphDesigns, isGraph } from './graph-live.js';

let uidc = 0;
const fid = (k) => `gt-${++uidc}-${k}`;

function check(label, value, onchange) {
  const id = fid('c');
  const input = h('input', { type: 'checkbox', id, checked: Boolean(value), onchange: () => onchange(input.checked) });
  return h('div.form-row.check', input, h('label', { for: id }, label));
}

function select(label, options, value, onchange) {
  const id = fid('s');
  const sel = h('select.select', { id, onchange: () => onchange(sel.value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return h('div.form-row', h('label', { for: id }, label), sel);
}

function num(label, value, onchange, { min = -Infinity, max = Infinity, suffix = '', step = 1 } = {}) {
  const id = fid('n');
  const input = h('input', { type: 'text', id, inputmode: 'decimal', value: `${value}${suffix}`, autocomplete: 'off', spellcheck: false });
  const commit = () => {
    const v = parseFloat(String(input.value).replace(/[^\d.+-eE]/g, ''));
    if (!Number.isFinite(v)) return;
    const c = Math.min(max, Math.max(min, v));
    input.value = `${c}${suffix}`;
    onchange(c);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const cur = parseFloat(input.value) || 0;
    input.value = `${Math.min(max, Math.max(min, cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)))}${suffix}`;
    commit();
  });
  return h('div.form-row', h('label', { for: id }, label), input);
}

function text(label, value, onchange) {
  const id = fid('t');
  const input = h('input', { type: 'text', id, value: value ?? '', autocomplete: 'off', oninput: () => onchange(input.value) });
  return h('div.form-row', h('label', { for: id }, label), input);
}

/** Object > Graph > Type: everything about how the selected graphs draw. */
export async function graphTypeDialog(app) {
  const ed = app.editor;
  const graphs = selectedGraphs(ed);
  if (!graphs.length) {
    app.notify('Select a graph first.');
    return false;
  }
  const doc = ed.doc;
  const first = graphs[0].live;
  const st = { type: first.type, options: graphOptions(first.options) };
  let tx = null;
  const preview = () => {
    if (tx) tx.cancel();
    tx = doc.begin('Graph Type');
    for (const g of graphs) updateGraph(doc, g.id, { type: st.type, options: { ...st.options, series: graphOptions(doc.get(g.id).live.options).series } });
  };

  // Type picker: a radio group of graph type buttons.
  const typeButtons = GRAPH_TYPES.map((t) =>
    h('button.icon-btn.gt-type', {
      type: 'button',
      role: 'radio',
      'aria-label': TYPE_LABELS[t],
      'data-tip': TYPE_LABELS[t],
      'aria-checked': String(t === st.type),
      tabindex: t === st.type ? '0' : '-1',
      onclick: () => setType(t),
      onkeydown: (e) => {
        const i = GRAPH_TYPES.indexOf(st.type);
        const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null;
        if (next == null) return;
        e.preventDefault();
        setType(GRAPH_TYPES[(next + GRAPH_TYPES.length) % GRAPH_TYPES.length]);
        typeButtons[GRAPH_TYPES.indexOf(st.type)].focus();
      },
    }, icon(`tool-graph-${t}`, 20)),
  );
  const typeRow = h('div.gt-types', { role: 'radiogroup', 'aria-label': 'Graph type' }, typeButtons);
  const optsHost = h('div.form');
  const valueHost = h('div.form');
  const catHost = h('div.form');

  const setType = (t) => {
    st.type = t;
    typeButtons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(GRAPH_TYPES[i] === t));
      b.tabIndex = GRAPH_TYPES[i] === t ? 0 : -1;
    });
    renderAll();
    preview();
  };
  const set = (patch) => {
    Object.assign(st.options, patch);
    preview();
  };
  const setV = (patch) => {
    st.options.value = { ...st.options.value, ...patch };
    renderValue();
    preview();
  };
  const setC = (patch) => {
    st.options.category = { ...st.options.category, ...patch };
    preview();
  };

  const renderOptions = () => {
    const o = st.options;
    const t = st.type;
    const bar = t === 'bar' || t === 'stacked-bar';
    const rows = [];
    if (t !== 'pie') {
      rows.push(
        select(
          'Value axis',
          bar ? [['left', 'On Bottom'], ['right', 'On Top'], ['both', 'On Both Sides']] : [['left', 'On Left Side'], ['right', 'On Right Side'], ['both', 'On Both Sides']],
          o.valueAxis,
          (v) => set({ valueAxis: v }),
        ),
      );
    }
    rows.push(h('h3.form-heading', 'Style'));
    rows.push(check('Drop shadow', o.shadow, (v) => set({ shadow: v })));
    rows.push(check('Legend across top', o.legendTop, (v) => set({ legendTop: v })));
    rows.push(check('First row in front', o.firstRowFront, (v) => set({ firstRowFront: v })));
    rows.push(check('First column in front', o.firstColumnFront, (v) => set({ firstColumnFront: v })));
    rows.push(num('Label size', o.fontSize, (v) => set({ fontSize: v }), { min: 4, max: 72, suffix: ' pt' }));
    rows.push(h('h3.form-heading', 'Options'));
    if (['column', 'stacked-column', 'bar', 'stacked-bar'].includes(t)) {
      rows.push(num(bar ? 'Bar width' : 'Column width', o.columnWidth, (v) => set({ columnWidth: v }), { min: 1, max: 1000, suffix: '%' }));
      rows.push(num('Cluster width', o.clusterWidth, (v) => set({ clusterWidth: v }), { min: 1, max: 1000, suffix: '%' }));
    } else if (t === 'line' || t === 'scatter' || t === 'radar') {
      rows.push(check('Mark data points', o.markPoints, (v) => set({ markPoints: v })));
      rows.push(check('Connect data points', o.connectPoints, (v) => set({ connectPoints: v })));
      if (t === 'line') rows.push(check('Edge-to-edge lines', o.edgeToEdge, (v) => set({ edgeToEdge: v })));
      rows.push(check('Draw filled lines', o.filledLines, (v) => set({ filledLines: v })));
      rows.push(num('Line width', o.lineWidth, (v) => set({ lineWidth: v }), { min: 0.1, max: 100, suffix: ' pt' }));
      rows.push(num('Marker size', o.markerSize, (v) => set({ markerSize: v }), { min: 1, max: 100, suffix: ' pt' }));
    } else if (t === 'pie') {
      rows.push(select('Legend', [['standard', 'Standard Legend'], ['wedges', 'Legends in Wedges'], ['none', 'No Legend']], o.pieLegend, (v) => set({ pieLegend: v })));
      rows.push(select('Position', [['ratio', 'Ratio'], ['even', 'Even'], ['stacked', 'Stacked']], o.piePosition, (v) => set({ piePosition: v })));
      rows.push(select('Sort', [['none', 'None'], ['all', 'All'], ['first', 'First']], o.pieSort, (v) => set({ pieSort: v })));
    } else rows.push(h('p.form-help.gt-none', 'Area graphs have no further options.'));
    optsHost.replaceChildren(...rows);
  };

  const renderValue = () => {
    const v = st.options.value;
    const manual = check('Override calculated values', v.manual, (x) => setV({ manual: x }));
    const rows = [h('h3.form-heading', 'Tick values'), manual];
    if (v.manual) {
      rows.push(num('Min', v.min, (x) => setV({ min: x })));
      rows.push(num('Max', v.max, (x) => setV({ max: x })));
      rows.push(num('Divisions', v.divisions, (x) => setV({ divisions: Math.round(x) }), { min: 1, max: 100 }));
    }
    rows.push(h('h3.form-heading', 'Tick marks'));
    rows.push(select('Length', [['none', 'None'], ['short', 'Short'], ['full', 'Full Width']], v.tickLength, (x) => setV({ tickLength: x })));
    rows.push(num('Tick marks per division', v.tickCount, (x) => setV({ tickCount: Math.round(x) }), { min: 1, max: 20 }));
    rows.push(h('h3.form-heading', 'Labels'));
    rows.push(text('Prefix', v.prefix, (x) => ((st.options.value = { ...st.options.value, prefix: x }), preview())));
    rows.push(text('Suffix', v.suffix, (x) => ((st.options.value = { ...st.options.value, suffix: x }), preview())));
    valueHost.replaceChildren(...rows);
  };

  const renderCategory = () => {
    const c = st.options.category;
    catHost.replaceChildren(
      h('h3.form-heading', 'Tick marks'),
      select('Length', [['none', 'None'], ['short', 'Short'], ['full', 'Full Width']], c.tickLength, (x) => setC({ tickLength: x })),
      num('Tick marks per category', c.tickCount, (x) => setC({ tickCount: Math.round(x) }), { min: 1, max: 20 }),
      check('Draw tick marks between labels', c.between, (x) => setC({ between: x })),
    );
  };

  const renderAll = () => {
    renderOptions();
    renderValue();
    renderCategory();
    const noCat = st.type === 'pie' || st.type === 'scatter';
    tabs[2].hidden = noCat;
    tabs[1].hidden = st.type === 'pie';
    if (tabs[current].hidden) selectTab(0);
  };

  // Tabs: Graph Options, Value Axis, Category Axis.
  const panels = [h('div.gt-panel', typeRow, optsHost), h('div.gt-panel', valueHost), h('div.gt-panel', catHost)];
  const labels = ['Graph Options', 'Value Axis', 'Category Axis'];
  let current = 0;
  const tabs = labels.map((l, i) =>
    h('button.gt-tab', {
      type: 'button',
      role: 'tab',
      id: `gt-tab-${i}`,
      'aria-controls': `gt-panel-${i}`,
      onclick: () => selectTab(i),
      onkeydown: (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        let j = i;
        do j = (j + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        while (tabs[j].hidden);
        selectTab(j);
        tabs[j].focus();
      },
    }, l),
  );
  panels.forEach((p, i) => {
    p.id = `gt-panel-${i}`;
    p.setAttribute('role', 'tabpanel');
    p.setAttribute('aria-labelledby', `gt-tab-${i}`);
  });
  const selectTab = (i) => {
    current = i;
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    panels.forEach((p, j) => (p.hidden = i !== j));
  };
  renderAll();
  selectTab(0);
  const body = h('div.graph-type', h('div.gt-tabs', { role: 'tablist', 'aria-label': 'Graph settings' }, tabs), panels);
  preview();
  let ok;
  try {
    ok = await app.dialogs.open({
      title: 'Graph Type',
      body,
      className: 'graph-type-dialog',
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'OK', primary: true, value: true },
      ],
    });
  } finally {
    if (tx) tx.cancel();
    tx = null;
  }
  if (!ok) return false;
  doc.transact('Graph Type', () => {
    for (const g of graphs) updateGraph(doc, g.id, { type: st.type, options: { ...st.options, series: graphOptions(doc.get(g.id).live.options).series } });
  });
  ed.select(graphs.map((g) => g.id));
  app.prefs.set('graphOptions', { ...st.options, series: {} });
  return true;
}

// ---- designs ----

/** A list box of the document's designs with an optional "None". */
function designList(doc, { none = false, value = null, onchange }) {
  const id = fid('d');
  const items = [...(none ? [{ id: '', name: 'None' }] : []), ...graphDesigns(doc)];
  const sel = h('select.select.gd-designs', { id, size: Math.min(8, Math.max(4, items.length)), onchange: () => onchange(sel.value || null) }, items.map((d) => h('option', { value: d.id, selected: (value || '') === d.id }, d.name)));
  return { el: sel, id };
}

/** Object > Graph > Design: make, rename, delete and paste graph designs. */
export async function graphDesignDialog(app) {
  const ed = app.editor;
  const doc = ed.doc;
  let chosen = graphDesigns(doc)[0]?.id || null;
  const host = h('div.form');
  const note = h('p.form-help.gd-note', { role: 'status' });
  const artwork = () => ed.topSelection().filter((id) => !isGraph(doc.get(id)) && !doc.isLocked(id));
  const render = () => {
    const list = designList(doc, { value: chosen, onchange: (v) => ((chosen = v), render()) });
    const has = Boolean(chosen && graphDesigns(doc).some((d) => d.id === chosen));
    host.replaceChildren(
      h('label', { for: list.id }, 'Designs'),
      list.el,
      h(
        'div.gd-design-buttons',
        h('button.btn.small', { type: 'button', disabled: !artwork().length, onclick: () => {
          let d;
          doc.transact('New Design', () => (d = addDesign(doc, artwork(), nextDesignName(doc))));
          chosen = d?.id || chosen;
          note.textContent = d ? `${d.name} made from the selection.` : '';
          render();
        } }, 'New Design'),
        h('button.btn.small', { type: 'button', disabled: !has, onclick: async () => {
          const d = graphDesigns(doc).find((x) => x.id === chosen);
          const v = await app.dialogs.form({ title: 'Rename Design', fields: [{ key: 'name', label: 'Name', type: 'text', value: d.name }] });
          if (v?.name?.trim()) doc.transact('Rename Design', () => renameDesign(doc, chosen, v.name.trim()));
          render();
        } }, 'Rename...'),
        h('button.btn.small', { type: 'button', disabled: !has, onclick: () => {
          const id = chosen;
          doc.transact('Paste Design', () => {
            const g = pasteDesign(doc, id, ed.targetLayer().id);
            if (g) ed.select([g.id]);
          });
          note.textContent = 'A copy of the design was placed in the document.';
        } }, 'Paste Design'),
        h('button.btn.small', { type: 'button', disabled: !has, onclick: () => {
          doc.transact('Delete Design', () => deleteDesign(doc, chosen));
          chosen = graphDesigns(doc)[0]?.id || null;
          render();
        } }, 'Delete'),
        h('button.btn.small', { type: 'button', disabled: !unusedDesigns(doc).length, onclick: () => {
          const unused = unusedDesigns(doc);
          chosen = unused[0]?.id || chosen;
          note.textContent = `${unused.length} design${unused.length === 1 ? ' is' : 's are'} not used by any graph.`;
          render();
        } }, 'Find Unused'),
      ),
      note,
    );
  };
  render();
  await app.dialogs.open({ title: 'Graph Design', body: h('div.graph-design', host), buttons: [{ label: 'Done', primary: true, value: true }] });
  return true;
}

/** Object > Graph > Column: column designs for the selected series (or every series of the selected graphs). */
export async function graphColumnDialog(app) {
  const ed = app.editor;
  const doc = ed.doc;
  const picks = selectedSeries(ed);
  if (!picks.length) {
    app.notify('Select a graph, or a series of one with the Group Selection tool.');
    return false;
  }
  const cur = graphOptions(picks[0].graph.live.options).series[picks[0].index]?.column || {};
  const st = { design: cur.design || null, mode: cur.mode || 'vertical', unit: cur.unit ?? 10, fraction: cur.fraction || 'scale' };
  if (!graphDesigns(doc).length) {
    app.notify('Make a design first with Object > Graph > Design.');
    return false;
  }
  let tx = null;
  const preview = () => {
    if (tx) tx.cancel();
    tx = doc.begin('Graph Column');
    setSeriesOption(doc, picks, 'column', st.design ? { ...st } : null);
  };
  const list = designList(doc, { none: true, value: st.design, onchange: (v) => ((st.design = v), preview()) });
  const repeatRows = h('div.form', num('Each design represents', st.unit, (v) => ((st.unit = v), preview()), { min: 1e-6 }), select('For fractions', [['scale', 'Scale Design'], ['chop', 'Chop Design']], st.fraction, (v) => ((st.fraction = v), preview())));
  repeatRows.hidden = st.mode !== 'repeat';
  const body = h(
    'div.form.graph-column',
    h('label', { for: list.id }, 'Column design'),
    list.el,
    select('Column type', [['vertical', 'Vertically Scaled'], ['uniform', 'Uniformly Scaled'], ['repeat', 'Repeating'], ['sliding', 'Sliding']], st.mode, (v) => {
      st.mode = v;
      repeatRows.hidden = v !== 'repeat';
      preview();
    }),
    repeatRows,
    h('p.form-help', picks.length && picks.every((p) => p.graph === picks[0].graph) && picks.length < picks[0].graph.children.length ? 'Applies to the selected series.' : 'Applies to every series of the selected graphs.'),
  );
  preview();
  let ok;
  try {
    ok = await app.dialogs.open({ title: 'Graph Column', body, buttons: [{ label: 'Cancel', value: false }, { label: 'OK', primary: true, value: true }] });
  } finally {
    if (tx) tx.cancel();
    tx = null;
  }
  if (!ok) return false;
  doc.transact('Graph Column', () => setSeriesOption(doc, picks, 'column', st.design ? { ...st } : null));
  return true;
}

/** Object > Graph > Marker: marker designs for the selected series. */
export async function graphMarkerDialog(app) {
  const ed = app.editor;
  const doc = ed.doc;
  const picks = selectedSeries(ed);
  if (!picks.length) {
    app.notify('Select a graph, or a series of one with the Group Selection tool.');
    return false;
  }
  if (!graphDesigns(doc).length) {
    app.notify('Make a design first with Object > Graph > Design.');
    return false;
  }
  const cur = graphOptions(picks[0].graph.live.options).series[picks[0].index]?.marker || {};
  let design = cur.design || null;
  let tx = null;
  const preview = () => {
    if (tx) tx.cancel();
    tx = doc.begin('Graph Marker');
    setSeriesOption(doc, picks, 'marker', design ? { design } : null);
  };
  const list = designList(doc, { none: true, value: design, onchange: (v) => ((design = v), preview()) });
  const body = h('div.form.graph-marker', h('label', { for: list.id }, 'Marker design'), list.el, h('p.form-help', 'Markers show on line, scatter and radar graphs with marked data points.'));
  preview();
  let ok;
  try {
    ok = await app.dialogs.open({ title: 'Graph Marker', body, buttons: [{ label: 'Cancel', value: false }, { label: 'OK', primary: true, value: true }] });
  } finally {
    if (tx) tx.cancel();
    tx = null;
  }
  if (!ok) return false;
  doc.transact('Graph Marker', () => setSeriesOption(doc, picks, 'marker', design ? { design } : null));
  return true;
}
