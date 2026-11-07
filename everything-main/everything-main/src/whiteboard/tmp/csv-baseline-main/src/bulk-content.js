import { canonicalLanguage } from "./accessibility/language-tag.js";
import { appendRun, textSegments } from "./rich-text.js";
import { tableCellContent } from "./table-language.js";
import { authoredTextHTML } from "./accessibility/object-content.js";
import { item, validateBoard, COLORS, escape } from "./model.js";
import { wrapText } from "./text.js";
import { fontStack } from "./fonts.js";
import { t } from "./i18n.js";

const MAX_TEXT = 1_000_000;
const GRID_LIMIT = "Paste up to 50 rows and 100 columns at a time.";
export const TABLE_LIMIT =
  "Tables support up to 20 rows, 12 columns, and 2,000 characters per cell.";

function checkText(text) {
  if (text.length > MAX_TEXT)
    throw Error("Paste up to 1 million characters at a time.");
}
function rectangular(rows) {
  const width = Math.max(...rows.map((row) => row.length));
  if (rows.length > 50 || width > 100) throw Error(GRID_LIMIT);
  return rows.map((row) =>
    Array.from({ length: width }, (_, c) => row[c] ?? ""),
  );
}

// Spreadsheet TSV supports quoted tabs, embedded newlines, and doubled quotes.
export function parseCells(text) {
  checkText(text);
  text = text.replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [],
    value = "",
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(value);
    value = "";
    closed = false;
    if (row.length > 100) throw Error(GRID_LIMIT);
  };
  for (let n = 0; n < text.length; n++) {
    const char = text[n];
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[n + 1] === '"') {
        value += '"';
        n++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === "\t" || char === "\n") {
      cell();
      if (char === "\n") {
        rows.push(row);
        row = [];
        if (rows.length > 50) throw Error(GRID_LIMIT);
      }
    } else if (char === '"' && value === "" && !closed) quoted = true;
    else {
      if (closed)
        throw Error("Check the quotes in the pasted spreadsheet cells.");
      value += char;
    }
  }
  if (quoted) throw Error("Check the quotes in the pasted spreadsheet cells.");
  if (!text.endsWith("\n") || row.length || value || closed) {
    cell();
    rows.push(row);
  }
  return rectangular(rows.length ? rows : [[""]]);
}

export function cellsText(cells) {
  const text = cells
    .map((row) =>
      row
        .map((value) =>
          /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value,
        )
        .join("\t"),
    )
    .join("\n");
  // A last empty one-column record needs its own terminator, otherwise it is
  // indistinguishable from the preceding record's optional trailing newline.
  return cells.at(-1)?.length === 1 && cells.at(-1)[0] === ""
    ? text + "\n"
    : text;
}

function cellContent(cell) {
  const lang = canonicalLanguage(cell.closest("[lang]")?.getAttribute("lang")),
    runs = [];
  let text = "";
  function add(value, tag) {
    const start = text.length;
    text += value;
    if (tag && tag !== lang) appendRun(runs, start, text.length, { lang: tag });
  }
  function walk(node, tag) {
    if (node.nodeType === 3) {
      add(node.textContent.replace(/\r\n?/g, "\n"), tag);
      return;
    }
    if (
      node.nodeType !== 1 ||
      /^(SCRIPT|STYLE|TEMPLATE|IMG)$/.test(node.tagName)
    )
      return;
    if (node.hasAttribute("lang"))
      tag = canonicalLanguage(node.getAttribute("lang"));
    if (node.tagName === "BR") {
      add("\n", tag);
      return;
    }
    for (const child of node.childNodes) {
      const block = /^(P|DIV)$/.test(child.tagName);
      if (block && text && !text.endsWith("\n")) add("\n", tag);
      walk(child, tag);
      if (block && child.nextSibling && !text.endsWith("\n")) add("\n", tag);
    }
  }
  walk(cell, lang);
  return {
    text,
    ...(lang ? { lang } : {}),
    ...(runs.length ? { textRuns: runs } : {}),
  };
}
export function readCells(data, doc = document) {
  return readTableContent(data, doc)?.cells || null;
}
export function readTableContent(data, doc = document) {
  const html = data.getData("text/html");
  if (/<table[\s>]/i.test(html)) {
    if (html.length > 4 * MAX_TEXT)
      throw Error("Paste up to 1 million characters at a time.");
    // Template contents are inert: no clipboard markup enters the live document.
    const template = doc.createElement("template");
    template.innerHTML = html;
    const tables = template.content.querySelectorAll("table");
    if (tables.length !== 1)
      throw Error("Paste one spreadsheet range at a time.");
    const table = tables[0],
      rows = [],
      cellLanguages = {};
    if (table.rows.length > 50) throw Error(GRID_LIMIT);
    for (const [r, tr] of Array.from(table.rows).entries()) {
      rows[r] ||= [];
      let c = 0;
      for (const td of tr.cells) {
        while (rows[r][c] !== undefined) c++;
        const height = td.rowSpan || table.rows.length - r,
          width = td.colSpan;
        if (r + height > 50 || c + width > 100) throw Error(GRID_LIMIT);
        const { text: value, ...metadata } = cellContent(td);
        if (Object.keys(metadata).length) cellLanguages[`${r},${c}`] = metadata;
        for (let y = r; y < r + height; y++) {
          rows[y] ||= [];
          for (let x = c; x < c + width; x++) {
            if (rows[y][x] !== undefined)
              throw Error("Paste one spreadsheet range at a time.");
            rows[y][x] = y === r && x === c ? value : "";
          }
        }
        c += width;
      }
    }
    if (rows.length && rows.some((row) => row.length)) {
      const cells = rectangular(rows);
      checkText(cells.flat().join(""));
      return {
        cells,
        ...(Object.keys(cellLanguages).length ? { cellLanguages } : {}),
      };
    }
  }
  const text = data.getData("text/plain");
  // Multiline prose remains ordinary text; HTML identifies single-column sheets.
  return text.includes("\t") ? { cells: parseCells(text) } : null;
}

export function bulkLines(text, columns = 3) {
  checkText(text);
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  if (lines.length > 5000)
    throw Error("A board can contain up to 5,000 objects.");
  const rows = [];
  for (let n = 0; n < lines.length; n += columns)
    rows.push(lines.slice(n, n + columns));
  return rows;
}

export const fitsTable = (cells) =>
  cells.length > 0 &&
  cells.length <= 20 &&
  cells.every(
    (row) => row.length <= 12 && row.every((value) => value.length <= 2000),
  );

export function pasteTable(cells, incoming, r, c) {
  const height = Math.max(cells.length, r + incoming.length),
    width = Math.max(cells[0].length, c + incoming[0].length);
  if (height > 20 || width > 12 || !fitsTable(incoming))
    throw Error(TABLE_LIMIT);
  const result = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => cells[y]?.[x] ?? ""),
  );
  incoming.forEach((row, y) =>
    row.forEach((value, x) => {
      result[r + y][c + x] = value;
    }),
  );
  return result;
}

// Measured in the table's own font, as it is drawn.
export function tableHeight(cells, width, ctx, size = 15, family = "dm-sans") {
  ctx.font = `400 ${size}px ${fontStack(family)}`;
  return (
    cells.length *
    Math.max(
      75,
      ...cells
        .flat()
        .map(
          (value) =>
            wrapText(ctx, value, Math.max(1, width / cells[0].length - 18))
              .length *
              size *
              1.35 +
            18,
        ),
    )
  );
}

export function cellObjects(
  cells,
  mode,
  point,
  ctx,
  color = COLORS[0],
  cellLanguages,
) {
  if (!cells.length) return [];
  let objects;
  if (mode === "table") {
    if (!fitsTable(cells)) throw Error(TABLE_LIMIT);
    const w = cells[0].length * 170;
    objects = [
      item("table", point.x, point.y, {
        cells: cells.map((row) => [...row]),
        ...(cellLanguages && Object.keys(cellLanguages).length
          ? { cellLanguages: structuredClone(cellLanguages) }
          : {}),
        w,
        h: tableHeight(cells, w, ctx),
        color: "#ffffff",
      }),
    ];
  } else {
    objects = [];
    ctx.font = '400 19px "DM Sans", system-ui, sans-serif';
    let y = point.y;
    for (const [r, row] of cells.entries()) {
      let rowHeight = 160;
      for (const [c, text] of row.entries()) {
        if (text.length > 20000)
          throw Error("Use up to 20,000 characters per sticky note.");
        const h = Math.max(
          160,
          wrapText(ctx, text, 158).length * 19 * 1.35 + 32,
        );
        rowHeight = Math.max(rowHeight, h);
        objects.push(
          item("note", point.x + c * 214, y, {
            ...tableCellContent({ cells, cellLanguages }, r, c, false),
            color,
            h,
          }),
        );
      }
      y += rowHeight + 24;
    }
  }
  validateBoard({ version: 1, title: "Pasted content", items: objects });
  return objects;
}

export function createBulkContent(api) {
  function open(
    source,
    point = api.center(),
    target = api.board(),
    cellLanguages,
  ) {
    if (!target || !api.canAdd()) return;
    const canvas = document.querySelector("#canvas"),
      spreadsheet = !!source;
    api.modal(
      spreadsheet ? "Paste spreadsheet" : "Bulk sticky notes",
      `<form class="bulk-form">${spreadsheet ? '<p class="dialog-copy">Choose how to add these cells. Blank cells keep their positions.</p>' : '<label class="field">Ideas<textarea id="bulk-ideas" rows="7" aria-describedby="bulk-help" autofocus></textarea></label><p class="dialog-copy" id="bulk-help">One sticky note per line. Empty lines are skipped.</p>'}
      <div class="field-row">${spreadsheet ? '<label class="field">Paste as<select id="bulk-mode"><option value="notes">Sticky notes</option><option value="table">Table</option><option value="text">Plain text</option></select></label>' : '<label class="field">Columns<select id="bulk-columns"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option><option>8</option><option>10</option></select></label>'}
      <label class="field" id="bulk-color-field">Sticky color<select id="bulk-color">${COLORS.map((color, n) => `<option value="${color}">${["Yellow", "Green", "Blue", "Purple", "Peach", "White"][n]}</option>`).join("")}</select></label></div>
      <p class="dialog-copy" id="bulk-count" role="status" aria-live="polite"></p><div class="bulk-preview" aria-label="Content preview" data-user-content></div><p class="dialog-copy" id="bulk-error" role="alert"></p>
      <div class="dialog-footer"><button type="button" class="secondary" id="bulk-cancel">Cancel</button><button class="primary" type="submit">Add to board</button></div></form>`,
      (d) => {
        const form = d.querySelector("form"),
          mode = () => d.querySelector("#bulk-mode")?.value || "notes";
        let cells = [];
        const prepare = () => {
          cells =
            source ||
            bulkLines(
              d.querySelector("#bulk-ideas").value,
              +d.querySelector("#bulk-columns").value,
            );
          const count = cells.reduce((n, row) => n + row.length, 0);
          if (spreadsheet) {
            d.querySelector('[value="table"]').disabled = !fitsTable(cells);
            const text = cellsText(cells);
            d.querySelector('[value="text"]').disabled =
              !text.trim() || text.length > 20000;
          }
          d.querySelector("#bulk-count").textContent = spreadsheet
            ? `${t("Rows")}: ${cells.length} · ${t("Columns")}: ${cells[0].length} · ${t("Cells")}: ${count}`
            : `${t("Sticky notes")}: ${count}`;
          d.querySelector("#bulk-color-field").hidden = mode() !== "notes";
          const preview = d.querySelector(".bulk-preview"),
            color = d.querySelector("#bulk-color").value;
          preview.style.gridTemplateColumns = `repeat(${Math.min(3, cells[0]?.length || 3)}, minmax(0, 1fr))`;
          preview.setAttribute(
            "aria-label",
            t("Content preview") + ` · ${Math.min(6, count)} / ${count}`,
          );
          preview.innerHTML = cells
            .flat()
            .slice(0, 6)
            .map((value, n) => {
              const content = tableCellContent(
                { cells, cellLanguages },
                Math.floor(n / cells[0].length),
                n % cells[0].length,
                false,
              );
              return `<div style="background:${color}">${authoredTextHTML(content, value.slice(0, 180))}</div>`;
            })
            .join("");
          preview.hidden = mode() !== "notes";
          if (
            mode() === "notes" &&
            cells.some((row) => row.some((value) => value.length > 20000))
          )
            throw Error("Use up to 20,000 characters per sticky note.");
          if (target.items.length + (mode() === "notes" ? count : 1) > 5000)
            throw Error("A board can contain up to 5,000 objects.");
          return count;
        };
        const update = () => {
          try {
            form.querySelector('[type="submit"]').disabled = !prepare();
            d.querySelector("#bulk-error").textContent =
              spreadsheet && !fitsTable(cells) ? t(TABLE_LIMIT) : "";
          } catch (error) {
            form.querySelector('[type="submit"]').disabled = true;
            d.querySelector("#bulk-error").textContent = t(error.message);
          }
        };
        form.oninput = update;
        form.onchange = update;
        d.querySelector("#bulk-cancel").onclick = () => d.close();
        form.onsubmit = (event) => {
          event.preventDefault();
          if (api.board() !== target || !canvas?.isConnected) {
            d.close();
            return;
          }
          if (!api.canAdd()) return;
          try {
            if (!prepare()) return;
            const ctx = document.createElement("canvas").getContext("2d");
            const objects =
              mode() === "text"
                ? [api.textObject(cellsText(cells), point, ctx)]
                    .filter(Boolean)
                    .map((object) =>
                      Object.assign(
                        object,
                        tableTSVContent({ cells, cellLanguages }),
                      ),
                    )
                : cellObjects(
                    cells,
                    mode(),
                    point,
                    ctx,
                    d.querySelector("#bulk-color").value,
                    cellLanguages,
                  );
            if (api.insert(objects, target)) d.close();
          } catch (error) {
            d.querySelector("#bulk-error").textContent = t(error.message);
          }
        };
        update();
        d.querySelector(spreadsheet ? "#bulk-mode" : "#bulk-ideas").focus();
      },
    );
  }
  return { open };
}

export function tableTSVContent(table) {
  let text = "";
  const runs = [];
  const add = (value, lang) => {
    const start = text.length;
    text += value;
    if (lang) appendRun(runs, start, text.length, { lang });
  };
  table.cells.forEach((row, r) => {
    if (r) add("\n");
    row.forEach((value, c) => {
      if (c) add("\t");
      const content = tableCellContent(table, r, c),
        quoted = /[\t\n\r"]/.test(value);
      if (quoted) add('"', content.lang);
      for (const part of textSegments(value, content.textRuns))
        add(
          quoted ? part.text.replaceAll('"', '""') : part.text,
          part.style.lang || content.lang,
        );
      if (quoted) add('"', content.lang);
    });
  });
  if (table.cells.at(-1)?.length === 1 && table.cells.at(-1)[0] === "")
    add("\n");
  return { text, ...(runs.length ? { textRuns: runs } : {}) };
}
