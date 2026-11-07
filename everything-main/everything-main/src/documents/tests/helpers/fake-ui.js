/**
 * A minimal stand-in for the app's UI controller: command handles
 * with observable state, plus the fonts / styles / document / zoom / search
 * slices the app reads. Tests mutate state through `set*` helpers and assert
 * on what the UI renders and which commands were executed.
 */

export function fakeUi({ commands = {}, fonts = null, styles = null, doc = null, search = null, selection = null, docApi = null } = {}) {
  const handles = new Map();
  const executed = [];

  const slice = (initial) => {
    let snap = initial;
    const subs = new Set();
    return {
      getSnapshot: () => snap,
      observe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
      set: (next) => { snap = { ...snap, ...next }; for (const fn of subs) fn(snap); },
    };
  };

  const handleFor = (id) => {
    if (!handles.has(id)) {
      let state = { enabled: true, active: false, supported: true, ...(commands[id] || {}) };
      const subs = new Set();
      handles.set(id, {
        id,
        getState: () => state,
        observe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
        execute: (payload) => { executed.push({ id, payload }); return true; },
        executeAsync: async (payload) => { executed.push({ id, payload }); return { success: true }; },
        set: (next) => { state = { ...state, ...next }; for (const fn of subs) fn(state); },
      });
    }
    return handles.get(id);
  };

  const fontsSlice = slice(fonts || {
    options: [{ value: 'Arial', label: 'Arial' }, { value: 'Georgia', label: 'Georgia' }],
    sizeOptions: [{ value: '11', label: '11' }, { value: '12', label: '12' }],
  });
  const stylesSlice = slice(styles || {
    quickGallery: [{ id: 'Normal', name: 'Normal' }, { id: 'Heading1', name: 'heading 1' }],
    activeParagraphStyleId: 'Normal',
    mixedSelection: false,
  });
  const docSlice = slice(doc || { ready: true, mode: 'editing', dirty: false });
  const zoomSlice = slice({ mode: 'manual', value: 100, min: 10, max: 500 });
  const searchSlice = slice(search || { query: '', total: 0, activeIndex: -1, open: false, available: true, caseSensitive: false, canReplace: true });
  const selectionSlice = slice(selection || { status: 'ready', empty: true, target: null, selectionTarget: null, activeMarks: [], quotedText: '' });
  const tablesSlice = slice({ inTable: false, tableNodeId: null, rowIndex: null, columnIndex: null, cellNodeId: null, rows: null, columns: null });
  const searchCalls = [];

  const registered = new Map();
  const ctx = () => ({ selection: selectionSlice.getSnapshot(), documentMode: docSlice.getSnapshot().mode, doc: docApi, execute: () => true, executeAsync: async () => true });

  return {
    executed,
    searchCalls,
    registered,
    commands: {
      get: handleFor,
      has: () => true,
      execute: (id, payload) => handleFor(id).execute(payload),
      executeAsync: (id, payload) => handleFor(id).executeAsync(payload),
      /** Custom commands: state comes from the registration's getState, run from execute. */
      register: (reg) => {
        registered.set(reg.id, reg);
        const h = handleFor(reg.id);
        const refresh = () => h.set(reg.getState ? reg.getState(ctx()) : {});
        h.executeAsync = async (payload) => { executed.push({ id: reg.id, payload }); const r = await reg.execute({ ...ctx(), payload }); refresh(); return r; };
        h.execute = (payload) => { executed.push({ id: reg.id, payload }); const r = reg.execute({ ...ctx(), payload }); refresh(); return r; };
        h.refresh = refresh;
        refresh();
        return { handle: h, unregister: () => registered.delete(reg.id) };
      },
    },
    fonts: fontsSlice,
    styles: stylesSlice,
    document: { ...docSlice, setMode: (m) => docSlice.set({ mode: m }) },
    zoom: { ...zoomSlice, set: (v) => zoomSlice.set({ value: v, mode: 'manual' }), setMode: (m) => zoomSlice.set({ mode: m }) },
    selection: { ...selectionSlice, getRects: () => [] },
    tables: { getContext: () => tablesSlice.getSnapshot(), isInTable: () => !!tablesSlice.getSnapshot().inTable, set: (next) => { tablesSlice.set(next); selectionSlice.set({}); } },
    search: {
      ...searchSlice,
      open: () => { searchCalls.push(['open']); searchSlice.set({ open: true }); return { ok: true }; },
      close: () => { searchCalls.push(['close']); searchSlice.set({ open: false, query: '', total: 0, activeIndex: -1 }); },
      clear: () => { searchCalls.push(['clear']); searchSlice.set({ query: '', total: 0, activeIndex: -1 }); },
      search: (q, opts) => {
        searchCalls.push(['search', q, opts]);
        const total = q === 'none' ? 0 : 3;
        searchSlice.set({ query: q, total, activeIndex: total ? 0 : -1, caseSensitive: !!opts?.caseSensitive });
        return searchSlice.getSnapshot();
      },
      next: () => { searchCalls.push(['next']); const s = searchSlice.getSnapshot(); if (s.total) searchSlice.set({ activeIndex: (s.activeIndex + 1) % s.total }); return { ok: true }; },
      previous: () => { searchCalls.push(['previous']); return { ok: true }; },
      replace: async (v) => { searchCalls.push(['replace', v]); return { ok: true }; },
      replaceAll: async (v) => { searchCalls.push(['replaceAll', v]); return { ok: true }; },
    },
  };
}
