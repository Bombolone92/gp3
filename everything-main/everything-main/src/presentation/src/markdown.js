// The Markdown the AI assistant writes, as page elements: paragraphs,
// headings, lists, quotes, code, tables, emphasis and links. Built node by
// node, never through innerHTML, so nothing in a reply (which may quote the
// deck's own text, written by anyone) can become markup.
//
// Pictures are never loaded: an image in a reply is how a prompt planted in
// a slide would carry the deck off to someone's server the moment the reply
// is shown (its address carrying the text), so ![alt](url) shows its alt
// text only. Links go only to http(s) and mailto addresses, open in a new
// tab, and name where they go in their tooltip.
//
// `options.refs(text)` finds references in plain text ([{ start, end,
// target }]), which `options.onRef(target)` follows when one is clicked: the
// assistant's "slide 3" goes to that slide. Text still arriving renders as
// far as it goes: an open code fence runs to the end.
import { el } from "./ui.js";

const FENCE = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*(?:(?<=\s)#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function renderMarkdown(text, options = {}) {
  const frag = document.createDocumentFragment();
  for (const node of blocks(
    String(text ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n"),
    options,
  ))
    frag.append(node);
  return frag;
}

function blocks(lines, options) {
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (!para.length) return;
    out.push(el("p", {}, ...inlineLines(para, options)));
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    let m;
    if ((m = FENCE.exec(line))) {
      flush();
      const close = new RegExp(
        `^\\s{0,3}${m[1][0] === "`" ? "`" : "~"}{${m[1].length},}\\s*$`,
      );
      const body = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(
        el("pre", { class: "md-code" }, el("code", {}, body.join("\n"))),
      );
      continue;
    }
    if ((m = HEADING.exec(line))) {
      flush();
      // A reply's headings are section labels in a narrow panel: two sizes.
      out.push(
        el(
          m[1].length <= 2 ? "h3" : "h4",
          { class: "md-h" },
          ...inline(m[2], options),
        ),
      );
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      out.push(el("hr", { class: "md-rule" }));
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const body = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        (m = QUOTE.exec(lines[i]))
      ) {
        body.push(m[1]);
        i++;
      }
      out.push(
        el("blockquote", { class: "md-quote" }, ...blocks(body, options)),
      );
      continue;
    }
    if (ITEM.test(line)) {
      flush();
      const list = parseList(lines, i, options);
      out.push(list.node);
      i = list.next;
      continue;
    }
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEP.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      flush();
      const table = parseTable(lines, i, options);
      out.push(table.node);
      i = table.next;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out;
}

// A list and the lists nested in it, by indentation.
function parseList(lines, start, options) {
  const first = ITEM.exec(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const node = el(ordered ? "ol" : "ul", { class: "md-list" });
  if (ordered) {
    const n = parseInt(first[2], 10);
    if (n !== 1) node.setAttribute("start", String(n));
  }
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const body = [m[3]];
    i++;
    const nested = [];
    while (i < lines.length) {
      const line = lines[i];
      const sub = ITEM.exec(line);
      if (sub && sub[1].length > indent) {
        nested.push(line);
        i++;
        continue;
      }
      if (!sub && line.trim() && line.match(/^\s*/)[0].length > indent) {
        if (nested.length) nested.push(line);
        else body.push(line.trim());
        i++;
        continue;
      }
      break;
    }
    const li = el("li", {}, ...inlineLines(body, options));
    if (nested.length) {
      const base = Math.min(
        ...nested.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length),
      );
      li.append(
        ...blocks(
          nested.map((l) => l.slice(Math.min(base, l.match(/^\s*/)[0].length))),
          options,
        ),
      );
    }
    node.append(li);
    // A blank line between items keeps the list going when the next line is
    // another item of it.
    if (i < lines.length && !lines[i].trim() && i + 1 < lines.length) {
      const again = ITEM.exec(lines[i + 1]);
      if (
        again &&
        again[1].length === indent &&
        /\d/.test(again[2]) === ordered
      )
        i++;
    }
  }
  return { node, next: i };
}

function cellsOf(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const out = [];
  let cur = "";
  let code = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "`") code = !code;
    if (ch === "|" && !code) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseTable(lines, start, options) {
  const head = cellsOf(lines[start]);
  const aligns = cellsOf(lines[start + 1]).map((c) =>
    c.startsWith(":") && c.endsWith(":")
      ? "center"
      : c.endsWith(":")
        ? "right"
        : null,
  );
  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes("|"))
    rows.push(cellsOf(lines[i++]));
  const cell = (tag, text, j) =>
    el(
      tag,
      aligns[j] ? { style: `text-align:${aligns[j]}` } : {},
      ...inline(text, options),
    );
  const table = el(
    "table",
    { class: "md-table" },
    el("thead", {}, el("tr", {}, ...head.map((t, j) => cell("th", t, j)))),
    el(
      "tbody",
      {},
      ...rows.map((row) =>
        el("tr", {}, ...head.map((_, j) => cell("td", row[j] ?? "", j))),
      ),
    ),
  );
  // A wide table scrolls within the reply rather than widening the panel.
  return {
    node: el(
      "div",
      {
        class: "md-table-wrap",
        tabindex: 0,
        role: "region",
        "aria-label": "Table",
      },
      table,
    ),
    next: i,
  };
}

// Lines of one paragraph, each break kept: the assistant's breaks are meant.
function inlineLines(lines, options) {
  const out = [];
  lines.forEach((line, i) => {
    if (i) out.push(el("br"));
    out.push(...inline(line, options));
  });
  return out;
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(\*\*|__)(?=\S)([\s\S]*?\S)\7|~~(?=\S)([\s\S]*?\S)~~|(\*|_)(?=[^\s*_])([\s\S]*?[^\s*_])\10(?![\w*])|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_])/g;

/** Inline Markdown: code, emphasis, links (web and mail only), references. */
export function inline(text, options = {}) {
  const out = [];
  let last = 0;
  const src = String(text);
  const re = new RegExp(INLINE.source, "g");
  let m;
  while ((m = re.exec(src))) {
    // Intraword underscores (snake_case names) are not emphasis.
    if (m[10] === "_" && /\w/.test(src[m.index - 1] || "")) continue;
    if (m.index > last)
      out.push(...plainText(src.slice(last, m.index), options));
    if (m[1])
      out.push(
        el(
          "code",
          { class: "md-inline" },
          ...plainText(m[2].replace(/^ (.*) $/, "$1"), options),
        ),
      );
    else if (m[3] !== undefined && m[4] !== undefined && src[m.index] === "!")
      out.push(
        el(
          "span",
          { class: "md-image", title: "Pictures in replies are not loaded" },
          m[3] ? `[${m[3]}]` : "[picture]",
        ),
      );
    else if (m[5] !== undefined)
      out.push(link(m[6], inline(m[5], { ...options, refs: null })));
    else if (m[7]) out.push(el("strong", {}, ...inline(m[8], options)));
    else if (m[9] !== undefined)
      out.push(el("s", {}, ...inline(m[9], options)));
    else if (m[10]) out.push(el("em", {}, ...inline(m[11], options)));
    else if (m[12]) out.push(link(m[12], [m[12]]));
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(...plainText(src.slice(last), options));
  return out;
}

export function safeHref(url) {
  const t = String(url ?? "").trim();
  if (/^mailto:[^\s]+$/i.test(t)) return t;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function link(url, children) {
  const href = safeHref(url);
  if (!href) return el("span", {}, ...children);
  return el(
    "a",
    {
      class: "md-link",
      href,
      target: "_blank",
      rel: "noopener noreferrer nofollow",
      title: href,
    },
    ...children,
  );
}

function plainText(text, options) {
  const found = options.refs ? options.refs(text) : [];
  if (!found?.length) return [text];
  const out = [];
  let at = 0;
  for (const { start, end, target } of found) {
    if (start < at) continue;
    if (start > at) out.push(text.slice(at, start));
    const label = text.slice(start, end);
    out.push(
      el(
        "button",
        {
          type: "button",
          class: "slide-ref",
          title: `Go to ${label.toLowerCase()}`,
          onclick: () => options.onRef?.(target),
        },
        label,
      ),
    );
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
