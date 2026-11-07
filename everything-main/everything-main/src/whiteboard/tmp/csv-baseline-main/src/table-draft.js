import {
  sameTableShape,
  tableCellMapping,
  mergeCellDraft,
} from "./table-cells.js";
import {
  tableCellContent,
  normalizedCellLanguage,
  cellLanguageKey,
} from "./table-language.js";
import { replaceTextRuns } from "./rich-text.js";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const explicit = (table, r, c) => tableCellContent(table, r, c, false);
const languageMap = (values) => ({
  cellLanguages: Object.keys(values).length ? values : undefined,
});
export function mergeTableDraft(local, before, remote) {
  const cells = mergeCellDraft(local.cells, before.cells, remote.cells),
    values = {};
  const ours =
    !equal(local.cells, before.cells) ||
    !equal(local.cellLanguages, before.cellLanguages);
  const theirs =
    !equal(remote.cells, before.cells) ||
    !equal(remote.cellLanguages, before.cellLanguages);
  const conflict = () => {
    throw Error(
      "This table changed. Reopen its properties before applying these edits.",
    );
  };
  if (
    !sameTableShape(local.cells, before.cells) ||
    !sameTableShape(remote.cells, before.cells)
  ) {
    if (ours && theirs) conflict();
    return {
      cells,
      ...languageMap(
        structuredClone((ours ? local : remote).cellLanguages || {}),
      ),
    };
  }
  cells.forEach((row, r) =>
    row.forEach((_, c) => {
      const own = explicit(local, r, c),
        old = explicit(before, r, c),
        latest = explicit(remote, r, c);
      if (!equal(own, old) && !equal(latest, old) && !equal(own, latest))
        conflict();
      const chosen = !equal(own, old) ? own : latest;
      const metadata = normalizedCellLanguage(chosen.text, {
        lang: chosen.lang,
        textRuns: chosen.textRuns,
      });
      if (Object.keys(metadata).length)
        values[cellLanguageKey(r, c)] = metadata;
    }),
  );
  return { cells, ...languageMap(values) };
}
// Queued edits apply per cell; unrelated cell languages survive. An edit may
// follow a structural change only when its row/column is uniquely identifiable.
export function rebaseTableLanguages(cells, local, before, remote) {
  if (!sameTableShape(local.cells, before.cells))
    return languageMap(structuredClone(local.cellLanguages || {}));
  const values = structuredClone(remote.cellLanguages || {}),
    mapping = tableCellMapping(before.cells, remote.cells);
  if (!mapping) return languageMap(values);
  before.cells.forEach((row, r) =>
    row.forEach((oldText, c) => {
      const rr = mapping.rows[r],
        cc = mapping.cols[c];
      if (rr === undefined || cc === undefined) return;
      const own = explicit(local, r, c),
        old = explicit(before, r, c),
        latest = explicit(remote, rr, cc),
        key = cellLanguageKey(rr, cc);
      if (equal(own, old)) return;
      if (
        !sameTableShape(before.cells, remote.cells) &&
        latest.text !== oldText
      )
        return;
      const text = cells[rr][cc];
      const lang = own.lang !== old.lang ? own.lang : latest.lang;
      let runs;
      if (own.text !== old.text || !equal(own.textRuns, old.textRuns)) {
        runs =
          own.text === text
            ? own.textRuns
            : replaceTextRuns(own.text, text, own.textRuns);
      } else
        runs =
          latest.text === text
            ? latest.textRuns
            : replaceTextRuns(latest.text, text, latest.textRuns);
      const metadata = normalizedCellLanguage(text, { lang, textRuns: runs });
      if (Object.keys(metadata).length) values[key] = metadata;
      else delete values[key];
    }),
  );
  return languageMap(values);
}
