import { canonicalLanguage } from "./accessibility/language-tag.js";
import {
  appendRun,
  replaceTextRuns,
  validateTextRuns,
  sliceTextRuns,
} from "./rich-text.js";

export const cellLanguageKey = (r, c) => `${r},${c}`;
export function cellLanguagePosition(key) {
  const match = /^(0|[1-9]\d?),(0|[1-9]\d?)$/.exec(key);
  if (!match || +match[1] >= 20 || +match[2] >= 12) return null;
  return { r: +match[1], c: +match[2] };
}
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
export function validateCellLanguage(text, value) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !["lang", "textRuns"].includes(key))
  )
    throw Error("Invalid table cell language.");
  if (value.lang !== undefined && !canonicalLanguage(value.lang))
    throw Error("Invalid table cell language.");
  validateTextRuns(text, value.textRuns);
  if (
    value.textRuns?.some((run) =>
      Object.keys(run.style).some((key) => key !== "lang"),
    )
  )
    throw Error("Invalid table cell language.");
}
export function validateTableLanguages(table) {
  const values = table.cellLanguages;
  if (values === undefined) return;
  if (table.type !== "table" || !object(values))
    throw Error("Invalid table cell languages.");
  for (const [key, value] of Object.entries(values)) {
    const p = cellLanguagePosition(key),
      text = p && table.cells?.[p.r]?.[p.c];
    if (typeof text !== "string") throw Error("Invalid table cell languages.");
    validateCellLanguage(text, value);
  }
}
export function normalizedCellLanguage(text, source = {}) {
  validateCellLanguage(text, source);
  const lang = canonicalLanguage(source.lang),
    runs = [];
  for (const run of source.textRuns || []) {
    const tag = canonicalLanguage(run.style.lang);
    if (tag) appendRun(runs, run.start, run.end, { lang: tag });
  }
  return {
    ...(lang ? { lang } : {}),
    ...(runs.length ? { textRuns: runs } : {}),
  };
}
export function tableCellContent(table, r, c, inherit = true) {
  const text = table.cells[r][c],
    metadata = normalizedCellLanguage(
      text,
      table.cellLanguages?.[cellLanguageKey(r, c)],
    );
  const lang = metadata.lang ?? (inherit && canonicalLanguage(table.lang));
  return { text, ...metadata, ...(lang ? { lang } : {}) };
}
export function tableLanguagePatch(table, cells, structure, changes = {}) {
  const values = {};
  for (const [key, source] of Object.entries(table.cellLanguages || {})) {
    const p = cellLanguagePosition(key);
    if (!p) continue;
    let { r, c } = p;
    if (structure) {
      const index = structure.axis === "row" ? r : c;
      if (
        index >= structure.index &&
        index < structure.index + structure.remove
      )
        continue;
      const shift =
        index >= structure.index + structure.remove
          ? structure.insert - structure.remove
          : 0;
      if (structure.axis === "row") r += shift;
      else c += shift;
    }
    const text = cells[r]?.[c];
    if (typeof text !== "string") continue;
    const value = structuredClone(source);
    if (value.textRuns && table.cells[p.r]?.[p.c] !== text)
      value.textRuns = replaceTextRuns(
        table.cells[p.r][p.c],
        text,
        value.textRuns,
      );
    const normalized = normalizedCellLanguage(text, value);
    if (Object.keys(normalized).length)
      values[cellLanguageKey(r, c)] = normalized;
  }
  for (const [key, source] of Object.entries(changes)) {
    const p = cellLanguagePosition(key),
      text = p && cells[p.r]?.[p.c];
    if (typeof text !== "string") throw Error("Invalid table cell languages.");
    const normalized = normalizedCellLanguage(text, source);
    if (Object.keys(normalized).length) values[key] = normalized;
    else delete values[key];
  }
  return {
    cells,
    cellLanguages: Object.keys(values).length ? values : undefined,
  };
}

// The text used by object names and captured facilitation labels, with cell
// overrides shifted into the combined string. Separators inherit the default.
export function tableTextContent(
  table,
  { rows = table.cells, separator = " · ", limit = Infinity } = {},
) {
  let text = "";
  const runs = [];
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      if (!value) return;
      if (text) text += separator;
      const start = text.length,
        content = tableCellContent(table, r, c, false);
      text += value;
      const segments = content.textRuns || [];
      let at = 0;
      for (const run of segments) {
        if (content.lang)
          appendRun(runs, start + at, start + run.start, {
            lang: content.lang,
          });
        appendRun(runs, start + run.start, start + run.end, run.style);
        at = run.end;
      }
      if (content.lang)
        appendRun(runs, start + at, text.length, { lang: content.lang });
    }),
  );
  let end = Math.min(text.length, limit);
  if (
    /[\uD800-\uDBFF]/.test(text[end - 1] || "") &&
    /[\uDC00-\uDFFF]/.test(text[end] || "")
  )
    end--;
  const clipped = sliceTextRuns(runs, 0, end),
    lang = canonicalLanguage(table.lang);
  return {
    text: text.slice(0, end),
    ...(lang ? { lang } : {}),
    ...(clipped.length ? { textRuns: clipped } : {}),
  };
}

// Source refresh replaces values. Keep a cell's declared context and unchanged
// passages; changed values must not reuse ranges over unrelated source text.
export function refreshedTableLanguagePatch(table, cells) {
  const changes = {};
  cells.forEach((row, r) =>
    row.forEach((text, c) => {
      if (text !== table.cells[r]?.[c]) {
        const lang = table.cellLanguages?.[cellLanguageKey(r, c)]?.lang;
        changes[cellLanguageKey(r, c)] = lang ? { lang } : {};
      }
    }),
  );
  return tableLanguagePatch(table, cells, undefined, changes);
}
