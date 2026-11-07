// Content extraction from PowerPoint, Word, and Excel files (Office Open
// XML). Extractors return plain document models; src/content/layout.js turns
// them into board objects. Nothing here renders markup or fetches anything.
import { readZip, resolvePart, ZipError } from "../unzip.js";
import {
  NS,
  parseXML,
  all,
  first,
  children,
  attr,
  relationships,
} from "./xml.js";
import { sniffImage, extension, IMAGE_BYTES } from "./binary.js";
// Spreadsheet text writes characters such as a carriage return as _xHHHH_,
// and an underscore that starts such text as _x005F_. Characters text
// cannot hold stay as written.
const unescapeText = (text) =>
  text.replace(/_x([\dA-Fa-f]{4})_/g, (match, hex) => {
    const code = parseInt(hex, 16);
    return code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && (code < 0xd800 || code > 0xdfff) && code < 0xfffe)
      ? String.fromCharCode(code)
      : match;
  });

const XML_PART = 20 * 1024 * 1024;
export const SHEET_ROWS = 1000;
export const SHEET_COLUMNS = 120;

function context(bytes, options = {}) {
  // Parts over XML_PART are only ever read from their start.
  const zip = readZip(bytes, { start: XML_PART, ...options.limits });
  const Parser = options.DOMParser || globalThis.DOMParser;
  const skipped = { images: 0, formats: new Set(), large: 0, damaged: 0 };
  async function xml(name) {
    if (!zip.has(name)) return null;
    if (zip.size(name) > XML_PART)
      throw Error("A part of this document is too large to import.");
    return parseXML(await zip.text(name), Parser);
  }
  // A part too large to read whole, read from its start through the first
  // `count` complete `tag` elements, or as many as fit, and closed by
  // `close` given the tag's namespace prefix. Reading grows in steps, so the
  // first rows of a huge sheet need only its first megabyte. Returns null
  // when the part is small enough to read whole.
  async function xmlStart(name, tag, close, count) {
    if (!zip.has(name) || zip.size(name) <= XML_PART) return null;
    const pattern = new RegExp(`</([\\w.-]+:)?${tag}\\s*>`, "g"),
      decoder = new TextDecoder();
    for (let size = 1024 * 1024; ; size = Math.min(size * 4, XML_PART)) {
      const text = decoder.decode(await zip.start(name, size));
      let end = -1,
        prefix = "",
        found = 0;
      for (const match of text.matchAll(pattern)) {
        end = match.index + match[0].length;
        prefix = match[1] || "";
        if (++found >= count) break;
      }
      if (end >= 0 && (found >= count || size >= XML_PART))
        return parseXML(text.slice(0, end) + close(prefix), Parser);
      if (size >= XML_PART)
        throw Error("A part of this document is too large to import.");
    }
  }
  async function rels(part) {
    const slash = part.lastIndexOf("/");
    const name = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
    return relationships(await xml(name), (target) =>
      resolvePart(part, target),
    );
  }
  // A picture used on many slides or paragraphs is one part, read once.
  const images = new Map();
  // A picture too large to add, or damaged, is skipped and reported; the
  // rest of the document still imports.
  async function image(target) {
    if (!target || !zip.has(target)) return null;
    if (zip.size(target) > IMAGE_BYTES) {
      skipped.large++;
      return null;
    }
    if (!images.has(target)) images.set(target, zip.bytes(target));
    let bytes;
    try {
      bytes = await images.get(target);
    } catch (error) {
      if (!(error instanceof ZipError)) throw error;
      skipped.damaged++;
      return null;
    }
    const mime = sniffImage(bytes);
    if (!mime) {
      skipped.images++;
      skipped.formats.add(extension(target).toUpperCase() || "?");
      return null;
    }
    return { name: target.split("/").pop(), bytes, mime };
  }
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Cancelled", "AbortError");
  };
  return { zip, xml, xmlStart, rels, image, skipped, check };
}
const clean = (text) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[\0-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

// DrawingML paragraph text: runs, fields, and line breaks in order.
function drawingParagraph(p) {
  let text = "";
  const visit = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType !== 1 || c.namespaceURI !== NS.a) continue;
      if (c.localName === "t") text += c.textContent;
      else if (c.localName === "br") text += "\n";
      else if (["r", "fld"].includes(c.localName)) visit(c);
    }
  };
  visit(p);
  return text;
}
const drawingText = (body) =>
  clean(children(body, NS.a, "p").map(drawingParagraph).join("\n"));
function drawingTable(tbl) {
  return children(tbl, NS.a, "tr").map((tr) =>
    children(tr, NS.a, "tc").map((tc) =>
      drawingText(first(tc, NS.a, "txBody")),
    ),
  );
}

const DIAGRAM = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
export async function extractPptx(bytes, options = {}) {
  const c = context(bytes, options);
  const presentation = await c.xml("ppt/presentation.xml");
  if (!presentation) throw Error("This is not a PowerPoint presentation.");
  const presRels = await c.rels("ppt/presentation.xml");
  // A slide part listed more than once is read once, so a small file cannot
  // make the same large slide count many times over.
  const order = [
    ...new Set(
      all(presentation, NS.p, "sldId")
        .map((s) => presRels.get(attr(s, NS.r, "id"))?.target)
        .filter(Boolean),
    ),
  ];
  const size = first(presentation, NS.p, "sldSz");
  const slides = [];
  // SmartArt data and speaker notes shared by many shapes or slides are
  // read once, so a small file cannot make one large part count many times.
  const shared = new Map();
  const once = (part, read) => {
    if (!shared.has(part)) shared.set(part, read());
    return shared.get(part);
  };
  const diagramText = (part) =>
    once(part, async () => {
      // A damaged one is left out, like a damaged picture.
      const data = await c.xml(part).catch(() => null);
      return clean(
        children(first(data, DIAGRAM, "ptLst"), DIAGRAM, "pt")
          .filter((pt) => ["", "node", "asst"].includes(attr(pt, null, "type")))
          .map((pt) => drawingText(first(pt, DIAGRAM, "t")))
          .filter(Boolean)
          .join("\n"),
      );
    });
  const notesText = (part) =>
    once(part, async () => {
      const notes = await c.xml(part);
      return clean(
        all(notes, NS.p, "sp")
          .filter(
            (sp) =>
              attr(first(first(sp, NS.p, "nvPr"), NS.p, "ph"), null, "type") ===
              "body",
          )
          .map((sp) => drawingText(first(sp, NS.p, "txBody")))
          .join("\n"),
      );
    });
  for (const part of order) {
    c.check();
    const doc = await c.xml(part);
    if (!doc) continue;
    const rels = await c.rels(part);
    const slide = { title: "", texts: [], images: [], tables: [], notes: "" };
    const tree = first(doc, NS.p, "spTree");
    const walk = async (node) => {
      for (const el of Array.from(node?.childNodes || [])) {
        c.check();
        // Shapes with equations, ink, or 3D models come in a preferred form
        // and a fallback; the first form with shapes is read.
        if (el.namespaceURI === MARKUP && el.localName === "AlternateContent") {
          const form =
            children(el, MARKUP, "Choice").find(
              (choice) => children(choice, NS.p).length,
            ) || children(el, MARKUP, "Fallback")[0];
          if (form) await walk(form);
          continue;
        }
        if (el.nodeType !== 1 || el.namespaceURI !== NS.p) continue;
        if (el.localName === "grpSp") await walk(el);
        else if (el.localName === "sp") {
          const ph = first(first(el, NS.p, "nvPr"), NS.p, "ph");
          const type = ph ? attr(ph, null, "type") || "body" : "";
          if (["sldNum", "dt", "ftr", "hdr"].includes(type)) continue;
          const text = drawingText(first(el, NS.p, "txBody"));
          if (!text) continue;
          if (!slide.title && ["title", "ctrTitle"].includes(type))
            slide.title = text.replace(/\n+/g, " ");
          else slide.texts.push(text);
        } else if (el.localName === "pic") {
          const blip = first(el, NS.a, "blip");
          const image = await c.image(
            rels.get(attr(blip, NS.r, "embed"))?.target,
          );
          if (image) slide.images.push(image);
        } else if (el.localName === "graphicFrame") {
          const tbl = first(el, NS.a, "tbl"),
            diagram = first(el, DIAGRAM, "relIds");
          if (tbl) {
            const rows = drawingTable(tbl);
            if (rows.length && rows.some((r) => r.some(Boolean)))
              slide.tables.push(rows);
          } else if (diagram) {
            // SmartArt keeps its text in a data part of its own, one point
            // per box; connections and layout points hold none.
            const target = rels.get(attr(diagram, NS.r, "dm"))?.target;
            const text = target ? await diagramText(target) : "";
            if (text) slide.texts.push(text);
          }
        }
      }
    };
    await walk(tree);
    const notesPart = [...rels.values()].find((r) =>
      r.type.endsWith("/notesSlide"),
    )?.target;
    if (notesPart) slide.notes = await notesText(notesPart);
    slides.push(slide);
  }
  return {
    kind: "slides",
    width: +attr(size, null, "cx") || 12192000,
    height: +attr(size, null, "cy") || 6858000,
    slides,
    skipped: c.skipped,
  };
}

// Word paragraph text, including hyperlinks and insertions, excluding
// deleted revisions and field instructions.
const MARKUP = "http://schemas.openxmlformats.org/markup-compatibility/2006";
function wordText(node) {
  let text = "";
  const visit = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      // Word can save runs in two forms; the preferred one is read.
      if (c.namespaceURI === MARKUP && c.localName === "AlternateContent") {
        const form =
          children(c, MARKUP, "Choice")[0] ||
          children(c, MARKUP, "Fallback")[0];
        if (form) visit(form);
        continue;
      }
      if (c.namespaceURI !== NS.w) continue;
      const name = c.localName;
      if (name === "t") text += c.textContent;
      else if (name === "tab") text += "\t";
      else if (name === "br" || name === "cr") text += "\n";
      else if (name === "noBreakHyphen") text += "-";
      // Tracked deletions and the old place of moved text are not content.
      else if (
        ["del", "moveFrom", "instrText", "delText", "pPr", "rPr"].includes(name)
      )
        continue;
      else visit(c);
    }
  };
  visit(node);
  return text;
}

export async function extractDocx(bytes, options = {}) {
  const c = context(bytes, options);
  const doc = await c.xml("word/document.xml");
  if (!doc) throw Error("This is not a Word document.");
  const rels = await c.rels("word/document.xml");
  const styles = await c.xml("word/styles.xml");
  const levels = new Map(),
    listStyles = new Set(),
    basedOn = new Map();
  for (const style of all(styles, NS.w, "style")) {
    const id = attr(style, NS.w, "styleId");
    const name = attr(first(style, NS.w, "name"), NS.w, "val").toLowerCase();
    const outline = first(first(style, NS.w, "pPr"), NS.w, "outlineLvl");
    let m;
    if (name === "title") levels.set(id, 0);
    else if ((m = /^heading (\d)$/.exec(name))) levels.set(id, +m[1]);
    else if (outline) levels.set(id, +attr(outline, NS.w, "val") + 1);
    if (/list/.test(name)) listStyles.add(id);
    const parent = attr(first(style, NS.w, "basedOn"), NS.w, "val");
    if (parent) basedOn.set(id, parent);
  }
  // A style based on a heading, such as a numbered Heading 1 in a company
  // template, has that heading's level unless it sets its own.
  for (const id of basedOn.keys()) {
    const seen = new Set();
    let n = id;
    while (!levels.has(n) && basedOn.has(n) && !seen.has(n)) {
      seen.add(n);
      n = basedOn.get(n);
    }
    if (levels.has(n)) levels.set(id, levels.get(n));
  }
  const blocks = [];
  // Shapes can carry a DrawingML picture and a VML fallback of the same
  // picture; the fallback is used only when the preferred form has none.
  const MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const fallback = (el, root) => {
    for (let n = el.parentNode; n && n !== root; n = n.parentNode)
      if (n.namespaceURI === MC && n.localName === "Fallback")
        return children(n.parentNode, MC, "Choice").some(
          (choice) =>
            all(choice, NS.a, "blip").length ||
            choice.getElementsByTagNameNS("*", "imagedata").length,
        );
    return false;
  };
  // Whether `el` is inside a text box within `root`; text boxes are read
  // as paragraphs of their own.
  const boxed = (el, root) => {
    for (let n = el.parentNode; n && n !== root; n = n.parentNode)
      if (n.namespaceURI === NS.w && n.localName === "txbxContent") return true;
    return false;
  };
  // Whether `el` is in a tracked deletion or the old place of moved content.
  const deleted = (el, root) => {
    for (let n = el.parentNode; n && n !== root; n = n.parentNode)
      if (
        n.namespaceURI === NS.w &&
        (n.localName === "del" || n.localName === "moveFrom")
      )
        return true;
    return false;
  };
  // Text boxes in a paragraph, outermost first, and only once when a shape
  // carries both a DrawingML and a VML form.
  const textBoxes = (node) =>
    Array.from(node.getElementsByTagNameNS(NS.w, "txbxContent")).filter(
      (box) => {
        if (boxed(box, node) || deleted(box, node)) return false;
        for (let n = box.parentNode; n && n !== node; n = n.parentNode)
          if (n.namespaceURI === MC && n.localName === "Fallback")
            return !children(n.parentNode, MC, "Choice").some(
              (choice) =>
                choice.getElementsByTagNameNS(NS.w, "txbxContent").length,
            );
        return true;
      },
    );
  // Pictures in text boxes a paragraph's own boxes read are left to them.
  const images = async (node, boxes = false) => {
    const found = [];
    for (const blip of all(node, NS.a, "blip")) {
      if (
        fallback(blip, node) ||
        deleted(blip, node) ||
        (boxes && boxed(blip, node))
      )
        continue;
      const image = await c.image(rels.get(attr(blip, NS.r, "embed"))?.target);
      if (image) found.push(image);
    }
    // Legacy VML pictures.
    for (const data of Array.from(
      node.getElementsByTagNameNS("*", "imagedata"),
    )) {
      if (
        fallback(data, node) ||
        deleted(data, node) ||
        (boxes && boxed(data, node))
      )
        continue;
      const image = await c.image(rels.get(attr(data, NS.r, "id"))?.target);
      if (image) found.push(image);
    }
    return found;
  };
  // Rows and cells can sit in content controls, such as a repeating
  // section, or in custom XML.
  const within = (node, name) =>
    children(node, NS.w).flatMap((el) =>
      el.localName === name
        ? [el]
        : el.localName === "sdt"
          ? within(first(el, NS.w, "sdtContent"), name)
          : el.localName === "customXml"
            ? within(el, name)
            : [],
    );
  // A cell's paragraphs, reading a text box once when a shape carries both
  // a DrawingML and a VML form of it.
  const cellText = (tc) => {
    const boxes = new Set(textBoxes(tc));
    const read = all(tc, NS.w, "p").filter((p) => {
      let box = null;
      for (let n = p.parentNode; n && n !== tc; n = n.parentNode)
        if (n.namespaceURI === NS.w && n.localName === "txbxContent") box = n;
      return !box || boxes.has(box);
    });
    return clean(read.map(wordText).join("\n"));
  };
  const visit = async (parent) => {
    for (const el of Array.from(parent.childNodes)) {
      if (el.nodeType !== 1 || el.namespaceURI !== NS.w) continue;
      c.check();
      if (el.localName === "sdt") {
        const content = first(el, NS.w, "sdtContent");
        if (content) await visit(content);
      } else if (el.localName === "customXml") {
        await visit(el);
      } else if (el.localName === "p") {
        // Only the paragraph's own properties count, not those of a
        // paragraph in a text box it anchors or of a tracked older version.
        const pPr = children(el, NS.w, "pPr")[0];
        const styleId = attr(children(pPr, NS.w, "pStyle")[0], NS.w, "val");
        const outline = children(pPr, NS.w, "outlineLvl")[0];
        let level = levels.has(styleId)
          ? levels.get(styleId)
          : /^heading(\d)$/i.test(styleId)
            ? +styleId.slice(7)
            : /^title$/i.test(styleId)
              ? 0
              : null;
        if (level == null && outline) level = +attr(outline, NS.w, "val") + 1;
        const text = clean(wordText(el));
        if (text) {
          if (level != null && level < 10)
            blocks.push({
              type: "heading",
              level,
              text: text.replace(/\n+/g, " "),
            });
          else
            blocks.push({
              type: "paragraph",
              text,
              list:
                !!children(pPr, NS.w, "numPr").length ||
                listStyles.has(styleId),
            });
        }
        for (const image of await images(el, true))
          blocks.push({ type: "image", image });
        for (const box of textBoxes(el)) await visit(box);
      } else if (el.localName === "tbl") {
        // A merged cell spans grid columns without placeholder cells, so
        // it is padded to keep later cells under their own columns. Only a
        // row's or cell's own properties count, not a nested table's.
        const span = (node, props, name) => {
          const prop = children(children(node, NS.w, props)[0], NS.w, name)[0];
          return Math.min(
            100,
            Math.max(0, parseInt(attr(prop, NS.w, "val")) || 0),
          );
        };
        const rows = within(el, "tr").map((tr) => {
          const cells = Array(span(tr, "trPr", "gridBefore")).fill("");
          for (const tc of within(tr, "tc")) {
            cells.push(cellText(tc));
            for (let n = span(tc, "tcPr", "gridSpan"); n > 1; n--)
              cells.push("");
          }
          return cells;
        });
        if (rows.some((r) => r.some(Boolean)))
          blocks.push({ type: "table", rows });
        for (const image of await images(el))
          blocks.push({ type: "image", image });
      }
    }
  };
  await visit(first(doc, NS.w, "body") || doc.documentElement);
  return { kind: "document", blocks, skipped: c.skipped };
}

// Excel: workbook sheet list first; rows are read for the chosen sheet.
// Built-in formats that show a date, a time of day, or an elapsed time.
// Times note whether they show seconds, and minutes:seconds show no hours.
const BUILTIN_FORMATS = new Map([
  ...[14, 15, 16, 17, 22, 27, 30, 36, 50, 57].map((id) => [id, "date"]),
  ...[18, 20].map((id) => [id, "time"]),
  ...[19, 21].map((id) => [id, "time:s"]),
  ...[45, 47].map((id) => [id, "minutes"]),
  [46, "duration:s"],
  ...[9, 10].map((id) => [id, "percent"]),
]);
function formatKind(code) {
  const plain = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  const seconds = /s/i.test(plain) || /\[s+\]/i.test(code) ? ":s" : "";
  if (/\[(h+|m+|s+)\]/i.test(code)) return "duration" + seconds;
  // A percent sign outside quotes shows the value times 100.
  if (plain.includes("%") && !/[dmyhs]/i.test(plain)) return "percent";
  if (/^general$/i.test(plain.trim()) || !/[dmyhs]/i.test(plain)) return null;
  // Without a day or year, m is minutes in a time such as h:mm.
  if (/[dy]/i.test(plain) || !/[hs]/i.test(plain)) return "date";
  return /h/i.test(plain) ? "time" + seconds : "minutes";
}
const pad = (n) => String(n).padStart(2, "0");
function serialDate(value, date1904, kind = "date") {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return value;
  if (kind !== "date") {
    const elapsed = kind.startsWith("duration");
    const total = Math.round((elapsed ? serial : serial % 1) * 86400);
    const hours = Math.floor(total / 3600) % (elapsed ? Infinity : 24),
      minutes = pad(Math.floor(total / 60) % 60),
      seconds = pad(total % 60);
    if (kind === "minutes") return `${minutes}:${seconds}`;
    return `${pad(hours)}:${minutes}${kind.endsWith(":s") ? `:${seconds}` : ""}`;
  }
  // The 1900 date system counts a 29 February 1900 that never was, so
  // serials before it are a day later than a plain count from 1899-12-30.
  const early = !date1904 && serial < 61;
  const ms = Math.round(
    (serial + (date1904 ? 1462 : 0) + (early && serial < 60 ? 1 : 0) - 25569) *
      86400000,
  );
  const iso = new Date(ms).toISOString();
  const day = early && serial >= 60 ? "1900-02-29" : iso.slice(0, 10);
  return serial % 1 ? `${day} ${iso.slice(11, 16)}` : day;
}
const number = (value) => {
  const n = Number(value);
  // Fifteen digits, as Excel shows them, keep long IDs and amounts intact.
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : value;
};
function column(ref) {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref || "");
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
  return { col: n - 1, row: +m[2] - 1 };
}

export async function openXlsx(bytes, options = {}) {
  const c = context(bytes, options);
  const workbook = await c.xml("xl/workbook.xml");
  if (!workbook) throw Error("This is not an Excel workbook.");
  const rels = await c.rels("xl/workbook.xml");
  const date1904 = ["1", "true"].includes(
    attr(first(workbook, NS.s, "workbookPr"), null, "date1904"),
  );
  const listed = new Set();
  const sheets = all(workbook, NS.s, "sheet")
    .map((s) => ({
      name: attr(s, null, "name").slice(0, 200) || "Sheet",
      part: rels.get(attr(s, NS.r, "id"))?.target,
      hidden:
        attr(s, null, "state") !== "" && attr(s, null, "state") !== "visible",
    }))
    // A sheet part listed twice is offered once.
    .filter((s) => s.part && !listed.has(s.part) && listed.add(s.part));
  let shared = null,
    sharedCut = false,
    dateStyles = null;
  // `need` is the highest shared string number a sheet uses.
  async function prepare(need) {
    if (shared && (!sharedCut || need < shared.length)) return;
    // Strings are numbered as they first appear, so the start of a very
    // large list holds the strings of a sheet's first rows.
    const cut = await c.xmlStart(
      "xl/sharedStrings.xml",
      "si",
      (p) => `</${p}sst>`,
      need + 1,
    );
    sharedCut = !!cut;
    const strings = cut || (await c.xml("xl/sharedStrings.xml"));
    shared = all(strings, NS.s, "si").map((si) =>
      unescapeText(
        Array.from(si.getElementsByTagNameNS(NS.s, "t"))
          .filter((t) => t.parentNode.localName !== "rPh")
          .map((t) => t.textContent)
          .join(""),
      ),
    );
    const styles = await c.xml("xl/styles.xml");
    const custom = new Map(
      all(styles, NS.s, "numFmt").map((f) => [
        +attr(f, null, "numFmtId"),
        attr(f, null, "formatCode"),
      ]),
    );
    dateStyles = children(first(styles, NS.s, "cellXfs"), NS.s, "xf").map(
      (xf) => {
        const id = +attr(xf, null, "numFmtId");
        return BUILTIN_FORMATS.get(id) || formatKind(custom.get(id) || "");
      },
    );
  }
  // A workbook opens before the import starts, so each read takes the
  // signal of the import it belongs to.
  async function read(index, { signal } = {}) {
    const sheet = sheets[index];
    if (!sheet) throw Error("Choose a sheet to import.");
    const check = () => {
      c.check();
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    };
    check();
    // Only the first rows are imported, so a sheet too large to read whole
    // is read up to its last complete row within the limit.
    const cut = await c.xmlStart(
      sheet.part,
      "row",
      (p) => `</${p}sheetData></${p}worksheet>`,
      SHEET_ROWS,
    );
    const doc = cut || (await c.xml(sheet.part));
    let need = -1;
    if (c.zip.size("xl/sharedStrings.xml") > XML_PART)
      for (const row of all(doc, NS.s, "row").slice(0, SHEET_ROWS))
        for (const cell of children(row, NS.s, "c"))
          if (attr(cell, null, "t") === "s")
            need = Math.max(need, +first(cell, NS.s, "v")?.textContent || 0);
    await prepare(need);
    const rows = [];
    // Excel keeps formatting on empty cells and rows, often far past the
    // content; only cells holding a value are left out.
    const filled = (node) =>
      node.getElementsByTagNameNS(NS.s, "v").length > 0 ||
      node.getElementsByTagNameNS(NS.s, "is").length > 0;
    let truncated = !!cut,
      nextRow = 0;
    const list = all(doc, NS.s, "row");
    for (const [index, row] of list.entries()) {
      check();
      const r = attr(row, null, "r") ? +attr(row, null, "r") - 1 : nextRow;
      nextRow = r + 1;
      if (r >= SHEET_ROWS) {
        truncated ||= list.slice(index).some(filled);
        break;
      }
      let nextCol = 0;
      for (const cell of children(row, NS.s, "c")) {
        const ref = column(attr(cell, null, "r"));
        const col = ref ? ref.col : nextCol;
        nextCol = col + 1;
        if (col >= SHEET_COLUMNS) {
          truncated ||= filled(cell);
          continue;
        }
        const type = attr(cell, null, "t");
        const v = first(cell, NS.s, "v")?.textContent ?? "";
        let value;
        if (type === "s") {
          value = shared[+v] ?? "";
          if (sharedCut && +v >= shared.length) truncated = true;
        } else if (type === "inlineStr")
          value = unescapeText(
            Array.from(cell.getElementsByTagNameNS(NS.s, "t"))
              .map((t) => t.textContent)
              .join(""),
          );
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (type === "str" || type === "e" || type === "d") value = v;
        else if (v === "") value = "";
        else if (dateStyles[+attr(cell, null, "s") || 0] === "percent")
          value = Number.isFinite(Number(v)) ? `${number(v * 100)}%` : v;
        else if (dateStyles[+attr(cell, null, "s") || 0])
          value = serialDate(
            v,
            date1904,
            dateStyles[+attr(cell, null, "s") || 0],
          );
        else value = number(v);
        if (value === "") continue;
        (rows[r] ||= [])[col] = String(value);
      }
    }
    return {
      name: sheet.name,
      rows: Array.from(rows, (row) => Array.from(row || [], (v) => v ?? "")),
      truncated,
    };
  }
  return { kind: "workbook", sheets, read, skipped: c.skipped };
}
