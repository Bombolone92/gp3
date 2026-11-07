import { textLinkURL } from "./text-link-data.js";
import { canonicalLanguage } from "./accessibility/language-tag.js";
export const MAX_LIST_INDENT = 7;
export const validListStyle = (style) =>
  style &&
  typeof style === "object" &&
  !Array.isArray(style) &&
  ["bullet", "number"].includes(style.list) &&
  Number.isInteger(style.indent) &&
  style.indent >= 0 &&
  style.indent <= MAX_LIST_INDENT &&
  Object.keys(style).every((key) => ["list", "indent"].includes(key));
export function validateTextBlocks(text, blocks) {
  if (blocks === undefined) return;
  if (!Array.isArray(blocks) || blocks.length > text.length + 1)
    throw Error("Invalid text list.");
  let previous = -1;
  for (const block of blocks) {
    if (
      !block ||
      Object.keys(block).some(
        (key) => !["start", "list", "indent"].includes(key),
      ) ||
      !Number.isInteger(block.start) ||
      block.start <= previous ||
      block.start > text.length ||
      (block.start !== 0 && text[block.start - 1] !== "\n") ||
      !validListStyle({ list: block.list, indent: block.indent })
    )
      throw Error("Invalid text list.");
    previous = block.start;
  }
}
export function textParagraphs(text, blocks = []) {
  const styles = new Map(blocks.map((b) => [b.start, b]));
  const rows = [];
  let start = 0;
  for (const value of text.split("\n")) {
    const style = styles.get(start),
      end = start + value.length;
    rows.push({
      start,
      end,
      text: value,
      ...(style ? { list: style.list, indent: style.indent } : {}),
    });
    start = end + 1;
  }
  return rows;
}
export function listRows(text, blocks) {
  const counts = [],
    kinds = [];
  return textParagraphs(text, blocks).map((row) => {
    if (!row.list) {
      counts.length = kinds.length = 0;
      return row;
    }
    const level = row.indent;
    counts.length = kinds.length = level + 1;
    counts[level] = kinds[level] === row.list ? (counts[level] || 0) + 1 : 1;
    kinds[level] = row.list;
    return {
      ...row,
      marker:
        row.list === "number"
          ? `${counts[level]}.`
          : ["•", "◦", "▪"][level % 3],
    };
  });
}
export function paragraphAt(text, blocks, at) {
  const start = at === 0 ? 0 : text.lastIndexOf("\n", at - 1) + 1;
  return blocks?.find((b) => b.start === start);
}
export function selectedParagraphs(text, blocks, start, end) {
  const last = end > start ? end - 1 : end;
  return textParagraphs(text, blocks).filter(
    (p) => p.start <= last && p.end >= start,
  );
}
export function formatTextBlocks(text, blocks = [], start, end, list) {
  const selected = new Set(
    selectedParagraphs(text, blocks, start, end).map((p) => p.start),
  );
  return textParagraphs(text, blocks).flatMap((p) => {
    const kind = selected.has(p.start) ? list : p.list;
    return kind ? [{ start: p.start, list: kind, indent: p.indent || 0 }] : [];
  });
}
export function indentTextBlocks(text, blocks, start, end, delta) {
  const rows = textParagraphs(text, blocks),
    selected = new Set(
      selectedParagraphs(text, blocks, start, end).map((p) => p.start),
    );
  // Carry descendants with their selected parent when moving an item.
  let parent;
  for (const row of rows) {
    if (selected.has(row.start) && row.list) parent = row.indent;
    else if (row.list && parent !== undefined && row.indent > parent)
      selected.add(row.start);
    else parent = undefined;
  }
  let allowed = true;
  for (let n = 0; n < rows.length; n++) {
    const row = rows[n];
    if (!row.list || !selected.has(row.start)) continue;
    if (
      delta > 0 &&
      (row.indent >= MAX_LIST_INDENT ||
        !rows[n - 1]?.list ||
        (!selected.has(rows[n - 1].start) && row.indent > rows[n - 1].indent))
    )
      allowed = false;
    if (delta < 0 && row.indent === 0) allowed = false;
  }
  if (!allowed) return blocks || [];
  return rows
    .filter((p) => p.list)
    .map((p) => ({
      start: p.start,
      list: p.list,
      indent: p.indent + (selected.has(p.start) ? delta : 0),
    }));
}
// Paragraph attributes follow their terminating newline; the final paragraph
// has an explicit tail style because an empty final item contains no character.
export function spliceTextBlocks(prev, blocks = [], start, end, insert) {
  const next = prev.slice(0, start) + insert + prev.slice(end),
    shift = insert.length - end + start;
  const rows = textParagraphs(prev, blocks),
    byEnd = new Map(rows.map((p) => [p.end, p]));
  const inherited = rows.find((p) => p.start <= start && p.end >= start);
  // A paragraph whose line ending went with the edit, after some of its
  // text, is joined with what followed and keeps its own style, as other
  // editors do when a line is deleted into the one before it.
  const joined = start > inherited.start && end > inherited.end;
  return textParagraphs(next).flatMap((p) => {
    let style;
    if (joined && p.start <= start && p.end >= start) style = inherited;
    else if (p.end === next.length)
      style = end === prev.length ? inherited : rows.at(-1);
    else if (p.end < start) style = byEnd.get(p.end);
    else if (p.end >= start + insert.length) style = byEnd.get(p.end - shift);
    else style = inherited;
    return style?.list
      ? [{ start: p.start, list: style.list, indent: style.indent }]
      : [];
  });
}

export function blocksFromDelta(delta, tail) {
  if (tail !== undefined && !validListStyle(tail))
    throw Error("Invalid shared text list.");
  const blocks = [];
  let at = 0,
    start = 0;
  for (const op of delta) {
    if (typeof op.insert !== "string") throw Error("Invalid shared text list.");
    const style = op.attributes?.block;
    if (style !== undefined && !validListStyle(style))
      throw Error("Invalid shared text list.");
    for (
      let n = op.insert.indexOf("\n");
      n !== -1;
      n = op.insert.indexOf("\n", n + 1)
    ) {
      if (style) blocks.push({ start, ...style });
      start = at + n + 1;
    }
    at += op.insert.length;
  }
  if (tail) blocks.push({ start, ...tail });
  return blocks;
}

export function listPlainText(text, blocks) {
  return listRows(text, blocks)
    .map((p) => {
      const prefix = p.list ? `${"  ".repeat(p.indent)}${p.marker} ` : "";
      return (
        prefix + p.text.replace(/\u2028/g, `\n${" ".repeat(prefix.length)}`)
      );
    })
    .join("\n");
}
export function listClipboardHTML(doc, text, blocks, appendContent) {
  const root = doc.createElement("div"),
    stack = [];
  for (const row of listRows(text, blocks)) {
    let target;
    if (!row.list) {
      stack.length = 0;
      target = doc.createElement("p");
      root.append(target);
    } else {
      const level = Math.min(row.indent, stack.length);
      stack.length = Math.min(stack.length, level + 1);
      if (!stack[level] || stack[level].kind !== row.list) {
        const list = doc.createElement(row.list === "number" ? "ol" : "ul");
        (level ? stack[level - 1].item : root).append(list);
        stack[level] = { kind: row.list, list };
      }
      target = doc.createElement("li");
      stack[level].list.append(target);
      stack[level].item = target;
    }
    if (appendContent) appendContent(target, row.text, row.start);
    else
      row.text.split("\u2028").forEach((part, n) => {
        if (n) target.append(doc.createElement("br"));
        target.append(doc.createTextNode(part));
      });
  }
  return root.innerHTML;
}
// Elements that start a line of their own.
const BLOCKS = "p,div,h1,h2,h3,h4,h5,h6,section,article,blockquote,ol,ul";
export function readTextHTML(doc, html) {
  if (!html || html.length > 1000000) return null;
  const template = doc.createElement("template");
  template.innerHTML = html;
  // Bound traversal before recursive extraction, including markup without
  // visible text. Unsupported pathological HTML falls back to plain text.
  const pending = [...template.content.childNodes].map((node) => [node, 0]);
  let visited = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (++visited > 40000 || depth > 64) return null;
    for (const child of node.childNodes) pending.push([child, depth + 1]);
  }
  if (!template.content.querySelector("ol,ul,a[href],[lang]")) return null;
  const rows = [];
  let length = 0;
  // Elements whose text is not shown. Names are compared in upper case, as
  // SVG and MathML give theirs in lower case.
  const skip = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "IFRAME",
    "OBJECT",
    "TEMPLATE",
    "TITLE",
    "HEAD",
  ]);
  const inline = (node) => {
    let text = "";
    const runs = [];
    // Outside preformatted text, line breaks and runs of spaces in the
    // source are one space, as a browser shows them, and a line starts
    // without one; <br> and block boundaries make the line breaks.
    const append = (value, link, lang) => {
      const start = text.length;
      text += value;
      if ((!link && !lang) || start === text.length) return;
      const previous = runs.at(-1);
      if (
        previous?.end === start &&
        previous.style.link === link &&
        previous.style.lang === lang
      )
        previous.end = text.length;
      else
        runs.push({
          start,
          end: text.length,
          style: { ...(link ? { link } : {}), ...(lang ? { lang } : {}) },
        });
    };
    const cut = (length) => {
      if (length === text.length) return;
      text = text.slice(0, length);
      for (const r of runs) {
        r.start = Math.min(r.start, text.length);
        r.end = Math.min(r.end, text.length);
      }
    };
    // Spaces at the end of a line are not shown either. They are removed as
    // each line ends, so the runs after them keep their offsets.
    const trimLine = () => cut(text.replace(/ +$/, "").length);
    const emit = (value, link, lang, pre = false) => {
      if (pre) value = value.replace(/\r\n?/g, "\n").replace(/\n/g, "\u2028");
      else {
        value = value.replace(/[ \t\r\n\f]+/g, " ");
        if (!text || text.endsWith("\u2028") || text.endsWith(" "))
          value = value.replace(/^ /, "");
      }
      value.split("\u2028").forEach((part, n) => {
        if (n) {
          trimLine();
          append("\u2028", link, lang);
          if (!pre) part = part.replace(/^ /, "");
        }
        if (part) append(part, link, lang);
      });
    };
    const walk = (part, link, lang, pre) => {
      if (part.nodeType === 3) return emit(part.data, link, lang, pre);
      if (
        part.nodeType !== 1 ||
        skip.has(part.tagName.toUpperCase()) ||
        ["OL", "UL"].includes(part.tagName)
      )
        return;
      lang = canonicalLanguage(part.getAttribute("lang")) || lang;
      if (part.tagName === "BR") return emit("\u2028", link, lang, true);
      if (part.tagName === "A") link = textLinkURL(part.getAttribute("href"));
      pre ||= part.tagName === "PRE";
      [...part.childNodes].forEach((child, n) => {
        if (n && ["DIV", "P"].includes(child.tagName))
          emit("\u2028", link, lang, true);
        walk(child, link, lang, pre);
      });
    };
    if (Array.isArray(node)) node.forEach((part) => walk(part));
    else walk(node);
    trimLine();
    // A line break ending a block adds no line, as in a browser; a block
    // holding only one is a single empty line.
    if (text.endsWith("\u2028")) {
      cut(text.length - 1);
      trimLine();
    }
    return { text, runs: runs.filter((r) => r.end > r.start) };
  };
  const add = (content, list, indent = 0) => {
    if (length > 20000) return;
    let text = typeof content === "string" ? content : content.text;
    text = text.replace(/\r\n?/g, "\n").replace(/\n/g, "\u2028");
    text = text.slice(0, 20000 - length);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    const runs = (content.runs || [])
      .filter((r) => r.start < text.length)
      .map((r) => ({ ...r, end: Math.min(r.end, text.length) }));
    rows.push({ text, list, indent, runs });
    length += text.length + 1;
  };
  const visit = (node, level = 0) => {
    if (
      length > 20000 ||
      node.nodeType !== 1 ||
      skip.has(node.tagName.toUpperCase())
    )
      return;
    if (["OL", "UL"].includes(node.tagName)) {
      for (const li of node.children) {
        if (li.tagName !== "LI") continue;
        add(
          inline(li),
          node.tagName === "OL" ? "number" : "bullet",
          Math.min(level, MAX_LIST_INDENT),
        );
        for (const nested of li.querySelectorAll("ol,ul"))
          if (nested.closest("li") === li) visit(nested, level + 1);
      }
    } else if (node.querySelector(BLOCKS)) {
      visitChildren(node, level);
    } else {
      const content = inline(node);
      if (content.text || node.tagName === "P" || node.querySelector("br"))
        add(content);
    }
  };
  const visitChildren = (parent, level = 0) => {
    // Keep source nodes in the inert template; adopting an image into the
    // active document, even offscreen, could start an unwanted request.
    let inlineGroup = [];
    const flush = () => {
      const content = inline(inlineGroup);
      // Space between blocks in the source is no line of its own.
      if (content.text.replace(/\u2028/g, "").trim()) add(content);
      inlineGroup = [];
    };
    for (const child of [...parent.childNodes]) {
      // A block, or an inline element holding blocks, as the wrapper some
      // editors put around a whole copied passage: its paragraphs stay
      // paragraphs rather than running together with line breaks.
      if (
        child.nodeType === 1 &&
        (/^(DIV|P|OL|UL|H[1-6]|SECTION|ARTICLE|BLOCKQUOTE)$/.test(
          child.tagName,
        ) ||
          child.querySelector(BLOCKS))
      ) {
        flush();
        visit(child, level);
      } else inlineGroup.push(child);
    }
    flush();
  };
  visitChildren(template.content);
  if (!rows.length) return null;
  let start = 0;
  const blocks = [],
    runs = [];
  for (const row of rows) {
    if (row.list) blocks.push({ start, list: row.list, indent: row.indent });
    for (const r of row.runs)
      runs.push({ ...r, start: start + r.start, end: start + r.end });
    start += row.text.length + 1;
  }
  return {
    text: rows.map((r) => r.text).join("\n"),
    blocks,
    ...(runs.length ? { runs } : {}),
  };
}
export const readListHTML = readTextHTML;
