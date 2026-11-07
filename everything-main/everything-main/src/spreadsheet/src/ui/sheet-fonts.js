import { fontStack } from '../core/format.js';
import { normalFontCss } from '../core/normal-font.js';
import { cellKey, parseKey } from '../core/cell.js';
import { customTableStyleAt, tableRows } from '../core/tables.js';

function tableBold(sheet, r, c, style) {
  const table = sheet.tables.find(t => r >= t.range.r1 && r <= t.range.r2 && c >= t.range.c1 && c <= t.range.c2);
  if (!table || table.style === 'none') return false;
  if (table.customStyle) {
    if (style?.bold != null) return !!style.bold;
    // Either row stripe can apply after filtering. Use the existing layering
    // helper for both possibilities without building a whole-table visible-row
    // ordinal cache merely to discover a font face.
    return [0, table.customStyle.firstRowStripe?.stripeSize || 1]
      .some(ordinal => customTableStyleAt(table, r, c, ordinal)?.bold);
  }
  const rows = tableRows(table);
  return r === rows.header || r === rows.totals || style?.bold !== false
    && (table.firstColumn && c === table.range.c1 || table.lastColumn && c === table.range.c2);
}

/** Start the active sheet's font downloads before offscreen cells are rendered
 * or a synchronous browser print measures them. Read sparse styles, not formula
 * results or a second DOM tree. FontFaceSet's loadingdone refreshes grid metrics.
 * Preparation is opportunistic; the app Print command still awaits its exact
 * rendered font set, including sheets outside the active one. */
export function installSheetFontLoading(wb, getSheetId) {
  const fonts = document.fonts;
  if (!fonts?.load || !fonts.check) return () => {};
  let sheet = null, version = wb.version, timer = null, jobs = [];
  const requested = new Map();
  const request = (font, text = ' ') => {
    if (!font) return;
    let seen = requested.get(font);
    if (!seen) requested.set(font, seen = new Set());
    let added = '';
    for (const ch of text) if (!seen.has(ch)) { seen.add(ch); added += ch; }
    if (!added) return;
    try {
      if (!fonts.check(font, added)) fonts.load(font, added).catch(() => {});
    } catch { /* A missing/invalid face retains the normal browser fallback. */ }
  };
  const styleFont = (style, bold = style?.bold, weight = 600) => {
    const family = fontStack(style?.font);
    // Size does not select a different face. Keep the request independent of
    // cell sizes so one family/style/weight shares a single character set.
    return family ? `${style?.italic ? 'italic' : 'normal'} ${bold ? weight : 400} 1em ${family}` : null;
  };
  function* cells(target, box) {
    const contains = (r, c) => !box || r >= box.r1 && r <= box.r2 && c >= box.c1 && c <= box.c2;
    const boldRanges = target.rules.filter(rule => rule.style?.bold).map(rule => rule.range);
    const entries = function* () {
      if (box && (box.r2 - box.r1 + 1) * (box.c2 - box.c1 + 1) < target.cells.size) {
        for (let r = box.r1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) yield [r, c, target.cells.get(cellKey(r, c))];
      } else {
        for (const [key, cell] of target.cells) { const { r, c } = parseKey(key); yield [r, c, cell]; }
      }
    };
    for (const [r, c, cell] of entries()) {
      if (cell && contains(r, c)) {
        const style = wb.styleAt(target.id, r, c);
        const text = ` ${typeof cell.v === 'string' ? cell.v : ''}${style?.code || ''}`;
        request(styleFont(style), text);
        // Rules can change with formula results. Warm their possible bold face
        // without evaluating offscreen formulas just to discover a resource.
        const bold = (target.tables.length && tableBold(target, r, c, style))
          || boldRanges.some(rg => r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2);
        if (bold && !style?.bold) request(styleFont(style, true), text);
      }
      yield;
    }
  }
  function* objects(value) {
    if (!value || typeof value !== 'object') return;
    // Chart appearance and text-box styles use the same font keys as cells.
    // Walk the normalized style data only, never image payloads or chart data.
    if (typeof value.font === 'string') request(styleFont(value, value.bold, 700), ` ${value.text || ''}`);
    yield;
    for (const child of Object.values(value)) if (child && typeof child === 'object') yield* objects(child);
  }
  function* other(target) {
    request(normalFontCss(wb.normalFont));
    request(styleFont(wb.normalStyle)); yield;
    for (const styles of [target.colStyles, target.rowStyles]) for (const style of styles.values()) {
      request(styleFont({ ...wb.normalStyle, ...style })); yield;
    }
    for (const chart of target.charts) {
      if (chart.type === 'text') { request(styleFont(chart.style), ` ${chart.text || ''}`); yield; }
      else yield* objects(chart.appearance);
    }
  }
  const schedule = () => { if (timer == null && jobs.length) timer = setTimeout(run, 0); };
  const run = () => {
    timer = null;
    const until = performance.now() + 4;
    // Bound work even on clocks whose precision is coarse or mocked in tests.
    for (let n = 0; jobs.length && n < 256 && performance.now() < until; n++) {
      if (jobs[0].next().done) jobs.shift();
    }
    schedule();
  };
  const refresh = event => {
    const current = wb.sheet(getSheetId());
    const changes = wb.changesSince(version);
    version = wb.version;
    if (!current) { sheet = null; jobs = []; return; }
    if (current !== sheet || !changes || event?.detail?.type === 'load') {
      sheet = current; jobs = [other(sheet), cells(sheet)];
    } else {
      for (const change of changes) {
        if (change.sheetId && change.sheetId !== current.id) continue;
        if (change.type === 'view' || change.type === 'names') continue;
        if (change.type === 'cells' && change.box && jobs.length < 8) jobs.push(cells(sheet, change.box));
        else if (change.type === 'layout' && jobs.length < 8) jobs.push(other(sheet));
        else { jobs = [other(sheet), cells(sheet)]; break; }
      }
    }
    schedule();
  };
  const retry = () => { requested.clear(); sheet = null; refresh(); };
  wb.addEventListener('change', refresh);
  window.addEventListener('online', retry);
  refresh();
  return () => {
    clearTimeout(timer); jobs = []; requested.clear();
    wb.removeEventListener('change', refresh);
    window.removeEventListener('online', retry);
  };
}
