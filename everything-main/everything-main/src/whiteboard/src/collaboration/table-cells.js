import * as Y from "yjs";
import { sameTableShape } from "../table-cells.js";
import { canonicalLanguage } from "../accessibility/language-tag.js";
import { runsFromDelta } from "../rich-text.js";
import {
  normalizedCellLanguage,
  validateCellLanguage,
} from "../table-language.js";
import { sizeKey, validSharedSize } from "./table-sizes.js";

export function legacyCellKey(key) {
  const match = /^cell:(0|[1-9]\d?),(0|[1-9]\d?)$/.exec(key);
  return !!match && +match[1] < 20 && +match[2] < 12;
}
export function legacyCellLanguageKey(key) {
  return (
    /^cell-lang:/.test(key) && legacyCellKey(key.replace("cell-lang:", "cell:"))
  );
}
export function validCellText(text) {
  if (
    !(text instanceof Y.Text) ||
    text.length > 2000 ||
    text
      .toDelta()
      .some(
        (op) =>
          typeof op.insert !== "string" ||
          Object.keys(op.attributes || {}).some((key) => key !== "lang"),
      )
  )
    return false;
  try {
    validateCellLanguage(text.toString(), {
      textRuns: runsFromDelta(text.toDelta()),
    });
    return true;
  } catch {
    return false;
  }
}
export function sharedCellLanguages(value, entry) {
  const cells = sharedCells(value, entry),
    result = {};
  if (!Array.isArray(cells)) return undefined;
  cells.forEach((row, r) =>
    row.forEach((plain, c) => {
      const text =
        value instanceof Y.Map
          ? value.get(`${r},${c}`)
          : entry?.get(`cell:${r},${c}`);
      const lang =
        value instanceof Y.Map
          ? value.get(`lang:${r},${c}`)
          : entry?.get(`cell-lang:${r},${c}`);
      if (lang !== undefined && !canonicalLanguage(lang))
        throw Error("Invalid shared table cell language.");
      const metadata = normalizedCellLanguage(plain, {
        ...(lang ? { lang } : {}),
        ...(text instanceof Y.Text
          ? { textRuns: runsFromDelta(text.toDelta()) }
          : {}),
      });
      if (Object.keys(metadata).length) result[`${r},${c}`] = metadata;
    }),
  );
  return Object.keys(result).length ? result : undefined;
}
export function sharedCells(value, entry) {
  if (!(value instanceof Y.Map))
    return Array.isArray(value)
      ? value.map((row, r) =>
          row.map(
            (text, c) => entry?.get(`cell:${r},${c}`)?.toString() ?? text,
          ),
        )
      : value;
  const rows = value.get("rows"),
    cols = value.get("cols");
  const sizes = [...value.keys()].filter((key) => sizeKey(key));
  const languages = [...value.keys()].filter((key) => /^lang:/.test(key));
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 20 ||
    !Number.isInteger(cols) ||
    cols < 1 ||
    cols > 12 ||
    value.size !== rows * cols + 2 + sizes.length + languages.length ||
    languages.some((key) => {
      const match = /^(0|[1-9]\d?),(0|[1-9]\d?)$/.exec(key.slice(5));
      return (
        !match ||
        +match[1] >= rows ||
        +match[2] >= cols ||
        !canonicalLanguage(value.get(key))
      );
    }) ||
    sizes.some((key) => {
      const { axis, index } = sizeKey(key);
      return (
        index >= (axis === "row" ? rows : cols) ||
        !validSharedSize(value.get(key))
      );
    })
  )
    throw Error("Invalid shared table structure.");
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const text = value.get(`${r},${c}`);
      if (!validCellText(text)) throw Error("Invalid shared table cell.");
      return text.toString();
    }),
  );
}
export function changeCells(
  entry,
  cells,
  changeText,
  changeTextRuns,
  languages = {},
) {
  let map = entry.get("cells");
  // Legacy entries already have a shared identity. Put their first per-cell
  // writes there so two clients never race to replace the entire legacy matrix.
  if (sameTableShape(map, cells)) {
    cells.forEach((row, r) =>
      row.forEach((value, c) => {
        const key = `cell:${r},${c}`,
          previous = entry.get(key);
        let text = previous;
        const metadata = languages[`${r},${c}`] || {};
        if (
          !(text instanceof Y.Text) &&
          (value !== map[r][c] || metadata.textRuns?.length)
        ) {
          text = new Y.Text(map[r][c]);
          entry.set(key, text);
        }
        if (text instanceof Y.Text) {
          changeText(text, value);
          changeTextRuns(text, metadata.textRuns);
        }
        const langKey = `cell-lang:${r},${c}`,
          lang = canonicalLanguage(metadata.lang);
        if (lang) {
          if (entry.get(langKey) !== lang) entry.set(langKey, lang);
        } else if (entry.has(langKey)) entry.delete(langKey);
      }),
    );
    return;
  }
  if (
    !(map instanceof Y.Map) ||
    map.get("rows") !== cells.length ||
    map.get("cols") !== cells[0].length
  ) {
    for (const key of [...entry.keys()])
      if (legacyCellKey(key) || legacyCellLanguageKey(key) || sizeKey(key))
        entry.delete(key);
    map = new Y.Map();
    entry.set("cells", map);
    map.set("rows", cells.length);
    map.set("cols", cells[0].length);
  }
  cells.forEach((row, r) =>
    row.forEach((value, c) => {
      const key = `${r},${c}`;
      let text = map.get(key);
      if (!(text instanceof Y.Text)) {
        text = new Y.Text();
        map.set(key, text);
      }
      const metadata = languages[key] || {},
        lang = canonicalLanguage(metadata.lang),
        langKey = `lang:${key}`;
      changeText(text, value);
      changeTextRuns(text, metadata.textRuns);
      if (lang) {
        if (map.get(langKey) !== lang) map.set(langKey, lang);
      } else if (map.has(langKey)) map.delete(langKey);
    }),
  );
}
