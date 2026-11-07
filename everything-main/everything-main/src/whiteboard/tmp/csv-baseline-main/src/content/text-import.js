// Plain text and Markdown to the document model used by Word imports:
// headings start frames, and each line, paragraph, or bullet becomes one
// sticky note. Markdown syntax is stripped to plain text; nothing is rendered
// as HTML.
// The same number as the 2 MB file limit in importer.js: decoded text never
// has more characters than its file has bytes, so any text file that limit
// accepts is read.
export const TEXT_CHARACTERS = 2 * 1024 * 1024;

// Named character references in common use; accented letters such as
// &eacute; are composed from their accent below.
const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  shy: "\u00ad",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  ndash: "–",
  mdash: "\u2014",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  times: "×",
  divide: "÷",
  plusmn: "±",
  sect: "§",
  para: "¶",
  iexcl: "¡",
  iquest: "¿",
  szlig: "ß",
  aelig: "æ",
  AElig: "Æ",
  oelig: "œ",
  OElig: "Œ",
  oslash: "ø",
  Oslash: "Ø",
};
const ACCENTS = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  uml: "\u0308",
  tilde: "\u0303",
  cedil: "\u0327",
  ring: "\u030a",
};
const entity = (name) => {
  if (name[0] === "#") {
    const code = /x/i.test(name[1])
      ? parseInt(name.slice(2), 16)
      : +name.slice(1);
    return code && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? String.fromCodePoint(code)
      : "\ufffd";
  }
  if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
  const m = /^([a-zA-Z])(acute|grave|circ|uml|tilde|cedil|ring)$/.exec(name);
  const letter = m && (m[1] + ACCENTS[m[2]]).normalize("NFC");
  return letter?.length === 1 ? letter : null;
};

// Backslash escapes and character references stand for plain characters,
// never markup, so ASCII punctuation from them is held as a private-use
// character until the markup is stripped. Code spans keep both as written,
// and their text is held whole, so `<div>` or `__init__` stays as typed.
const HELD = 0xf0000,
  HELD_PUNCTUATION = /[\u{f0021}-\u{f007e}]/gu;
const hold = (text) =>
  text.replace(/[!-/:-@[-`{-~]/g, (c) =>
    String.fromCodePoint(HELD + c.charCodeAt(0)),
  );
const release = (c) => String.fromCharCode(c.codePointAt(0) - HELD);
const literals = (text) =>
  text.replace(
    /`[^`]+`|\\([!-/:-@[-`{-~])|&(#\d{1,7}|#[xX][\da-fA-F]{1,6}|[a-zA-Z][a-zA-Z\d]{1,31});/g,
    (match, escaped, name) => {
      if (match[0] === "`") return hold(match.slice(1, -1));
      if (escaped) return hold(escaped);
      const decoded = name && entity(name);
      return decoded ? hold(decoded) : match;
    },
  );

// Every pattern stops at the next delimiter, so a crafted line cannot make
// matching take quadratic or worse time.
const inline = (text) =>
  literals(text)
    // Images keep their alternative text; remote images are never fetched.
    // One level of parentheses is allowed inside a destination, as in
    // wiki/Mercury_(planet).
    .replace(/!\[([^[\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    // Images and links by reference, as Google Docs exports pictures, keep
    // their text too; the definitions they point to are left out.
    .replace(/!\[([^[\]]*)\]\[[^[\]]*\]/g, "$1")
    .replace(/\[([^[\]]+)\]\[[^[\]]*\]/g, "$1")
    // A destination can be in angle brackets, as when it holds spaces, and
    // a title can be in double or single quotes or parentheses.
    .replace(
      /\[([^[\]]+)\]\((?:<([^<>]*)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\)/g,
      (_, label, bracketed, plain) => {
        const url = bracketed ?? plain;
        return !url || label === url ? label : `${label} (${url})`;
      },
    )
    // Autolinks keep their address, whether a link such as
    // <https://example.com> or <mailto:team@example.com>, or an email
    // address such as <team@example.com>; they are not tags to strip.
    .replace(
      /<([a-zA-Z][a-zA-Z\d+.-]{1,31}:[^<>\s]*|[\w.!#$%&'*+/=?^`{|}~-]+@[a-zA-Z\d.-]+)>/g,
      "$1",
    )
    .replace(/(\*\*|__)(?=\S)((?:(?!\1)[^\n])*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])([*_])(?=\S)([^*_\n]*?\S)\2(?=[^\w*]|$)/g, "$1$3")
    .replace(/~~(?=\S)((?:(?!~~)[^\n])*?\S)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<\/?[a-z][^<>]*>/gi, "")
    .replace(HELD_PUNCTUATION, release)
    .trim();

// A GitHub table's separator row: cells of dashes with optional colons,
// between pipes that may be left off at the ends.
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;

// Lines that start a heading, quote, fence, or thematic break.
const BLOCK_START =
  /^ {0,3}(?:#{1,6}(?:\s|$)|>|`{3}|~{3}|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/;

const tableRow = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => inline(cell.replace(/\\\|/g, "|")));

// Pictures saved as data in reference definitions, as Google Docs exports
// them, are no content and can be most of a file; they are dropped before
// its length is checked. Each line is tried once from its start.
const EMBEDDED = /^ {0,3}\[(?!\^)[^[\]\n]+\]:[ \t]*<?data:[^\n]*$/gm;
// Pictures pasted into the text as data, as many editors save them, lose
// their data the same way and keep their alternative text.
const INLINE_DATA = /(!\[[^[\]\n]*\]\()[ \t]*<?data:[^\s()<>]*>?/g;
const REFERENCE =
  /^ {0,3}\[(?!\^)[^[\]]+\]:[ \t]*(?:<[^<>]*>|[^\s<]\S*)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/;

export function parseText(text, { markdown = false } = {}) {
  if (markdown) text = text.replace(EMBEDDED, "").replace(INLINE_DATA, "$1");
  if (text.length > TEXT_CHARACTERS)
    throw Error("Choose a text file smaller than 2 MB.");
  const lines = text
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  // YAML front matter, as Obsidian, Jekyll, and Hugo write it at the top of
  // a file between --- lines, describes the file and is not content.
  if (markdown && lines[0].trim() === "---" && /^[\w-]+\s*:/.test(lines[1])) {
    const end = lines.findIndex(
      (line, n) => n > 0 && ["---", "..."].includes(line.trim()),
    );
    if (end > 0) lines.splice(0, end + 1);
  }
  const blocks = [];
  let fence = null,
    comment = false,
    code = [],
    paragraph = [];
  // HTML comments are left out, including ones spanning lines. Scanned with
  // indexOf so no pattern backtracks over a long line.
  const uncomment = (line) => {
    let out = "",
      at = 0;
    while (at < line.length) {
      if (comment) {
        const end = line.indexOf("-->", at);
        if (end < 0) return out;
        comment = false;
        at = end + 3;
      } else {
        const start = line.indexOf("<!--", at);
        if (start < 0) return out + line.slice(at);
        out += line.slice(at, start);
        comment = true;
        at = start + 4;
      }
    }
    return out;
  };
  const flush = () => {
    if (paragraph.length)
      blocks.push({
        type: "paragraph",
        text: paragraph.join(" "),
        list: false,
      });
    paragraph = [];
  };
  for (let n = 0; n < lines.length; n++) {
    let raw = lines[n];
    if (markdown) {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(raw);
      if (fence) {
        // Only a fence of the same kind, at least as long and with nothing
        // after it, closes the block, so a block can show shorter fences.
        if (
          fenceMatch &&
          fenceMatch[1][0] === fence[0] &&
          fenceMatch[1].length >= fence.length &&
          !raw.slice(fenceMatch[0].length).trim()
        ) {
          if (code.join("").trim())
            blocks.push({
              type: "paragraph",
              text: code.join("\n"),
              list: false,
            });
          fence = null;
          code = [];
        } else code.push(raw);
        continue;
      }
      // A backtick fence's info string has no backticks, so a line such as
      // ```npm install``` is inline code, not the start of a block.
      if (
        fenceMatch &&
        !comment &&
        !(
          fenceMatch[1][0] === "`" &&
          raw.slice(fenceMatch[0].length).includes("`")
        )
      ) {
        flush();
        fence = fenceMatch[1];
        continue;
      }
      if (comment || raw.includes("<!--")) {
        const wasComment = comment;
        raw = uncomment(raw);
        // A line that was only a comment is not a blank line either.
        if (!raw.trim() && (wasComment || comment || lines[n].trim())) continue;
      }
    }
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (!markdown) {
      // Plain text: one sticky note per nonblank line, bullets stripped.
      const text = line.replace(/^([-*•‣◦▪]|\d{1,4}[.)])\s+/, "");
      if (text) blocks.push({ type: "paragraph", text, list: text !== line });
      continue;
    }
    // A reference definition, such as [image1]: <data:image/png;base64,...>,
    // is not content: a destination and an optional title, nothing else.
    // Footnotes, written [^1]: text, and lines such as [Decision]: We ship
    // on Friday are.
    if (REFERENCE.test(raw)) {
      flush();
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      // An optional closing run of # after a space ends the heading.
      // Trimmed with a loop: /#+$/ backtracks quadratically on long runs.
      let end = m[2].length;
      while (end && m[2][end - 1] === "#") end--;
      const body = m[2].slice(0, end);
      const text = inline(
        body === m[2] || !body || /\s$/.test(body) ? body.trimEnd() : m[2],
      );
      if (text) blocks.push({ type: "heading", level: m[1].length, text });
      continue;
    }
    // Setext headings: a line underlined with === or ---. A list item or a
    // quote is not underlined this way, so --- under one is a break.
    const underline = (lines[n + 1] || "").trim();
    if (
      /^(=+|-+)$/.test(underline) &&
      !/^([-*+]|\d{1,4}[.)])\s|^>/.test(line)
    ) {
      flush();
      const text = inline(line);
      if (text)
        blocks.push({
          type: "heading",
          level: underline[0] === "=" ? 1 : 2,
          text,
        });
      n++;
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      flush();
      continue;
    }
    const separator = (lines[n + 1] || "").trim();
    if (
      line.includes("|") &&
      separator.includes("|") &&
      TABLE_SEPARATOR.test(separator)
    ) {
      flush();
      const rows = [tableRow(line)];
      n += 2;
      // As in GitHub Markdown, a table ends at a line that starts another
      // block, such as a heading, even when it holds a pipe.
      while (
        n < lines.length &&
        lines[n].trim() &&
        lines[n].includes("|") &&
        !BLOCK_START.test(lines[n])
      )
        rows.push(tableRow(lines[n++]));
      n--;
      blocks.push({ type: "table", rows });
      continue;
    }
    if ((m = /^([-*+]|\d{1,4}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line))) {
      flush();
      const text = inline(m[2]);
      if (text) blocks.push({ type: "paragraph", text, list: true });
      continue;
    }
    // One sticky note per line, like plain text.
    paragraph.push(inline(line.replace(/^(>\s?)+/, "")));
    flush();
  }
  flush();
  if (fence && code.join("").trim())
    blocks.push({ type: "paragraph", text: code.join("\n"), list: false });
  return {
    kind: "document",
    blocks: blocks.filter((b) => b.type !== "paragraph" || b.text),
    skipped: { images: 0, formats: new Set() },
  };
}
