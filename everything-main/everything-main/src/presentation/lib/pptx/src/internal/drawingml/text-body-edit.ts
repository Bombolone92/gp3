import {
  NS,
  type XmlElement,
  type XmlNode,
  elem,
  qname,
  firstChildElement,
  text,
  textContent,
} from "../xml/index.ts";
import { paragraphText, paragraphsOf, textBodyText } from "./text-body.ts";
import { rprChildRank } from "./text-format.ts";

/** A sequential edit in the body's visible UTF-16 text. Existing soft and
 * paragraph breaks retain their native kind; inserted newlines default to
 * paragraphs. Offsets must not divide a surrogate pair. */
export interface TextBodyEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly breakKind?: "paragraph" | "line";
}
const name = (local: string) => qname("a", local, NS.dml);
const is = (node: XmlNode, local: string): node is XmlElement =>
  node.kind === "element" &&
  node.name.namespaceURI === NS.dml &&
  node.name.localName === local;
const clone = <T extends XmlNode>(node: T): T => structuredClone(node);
const inline = (p: XmlElement) =>
  p.children.filter((n) => !is(n, "pPr") && !is(n, "endParaRPr"));
const value = (n: XmlNode): string => {
  if (is(n, "br")) return "\n";
  if (is(n, "r") || is(n, "fld")) {
    const t = firstChildElement(n, name("t"));
    return t ? textContent(t) : "";
  }
  return "";
};
const run = (content: string, properties: XmlElement | null) =>
  elem(name("r"), {
    children: [
      ...(properties ? [clone(properties)] : []),
      elem(name("t"), { children: content ? [text(content)] : [] }),
    ],
  });
const runProperties = (node: XmlNode): XmlElement | null =>
  node.kind === "element" ? firstChildElement(node, name("rPr")) : null;

// Character properties have native choice groups and a schema sequence. Merge
// explicit declarations over defaults without producing competing fills/effects
// or placing a paint after a font. The shared authoring ranks encode that order.
const mergeProperties = (
  base: XmlElement | null,
  direct: XmlElement | null,
): XmlElement | null => {
  if (!base && !direct) return null;
  const result = elem(name("rPr"), {
    attrs: base ? clone(base).attrs : [],
    prefixDecls: new Map(base?.prefixDecls),
    children: base ? base.children.map(clone) : [],
  });
  if (direct) {
    const key = (n: { namespaceURI: string; localName: string }) =>
      `${n.namespaceURI}|${n.localName}`;
    const attrs = new Set(direct.attrs.map((a) => key(a.name)));
    result.attrs = [
      ...result.attrs.filter((a) => !attrs.has(key(a.name))),
      ...clone(direct).attrs,
    ];
    const choice = (e: XmlElement) =>
      rprChildRank(e) < 99 ? `native:${rprChildRank(e)}` : key(e.name);
    const choices = new Set(
      direct.children
        .filter((n): n is XmlElement => n.kind === "element")
        .map(choice),
    );
    result.children = [
      ...result.children.filter(
        (n) => n.kind !== "element" || !choices.has(choice(n)),
      ),
      ...direct.children.map(clone),
    ];
    for (const [prefix, uri] of direct.prefixDecls)
      result.prefixDecls.set(prefix, uri);
  }
  const rank = (n: XmlNode) => (n.kind === "element" ? rprChildRank(n) : 99);
  result.children.sort((a, b) => rank(a) - rank(b));
  return result;
};
// A field is retained as a field unless its cached characters are edited.
// Literalizing an edited field keeps its character defaults and explicit rPr,
// but omits field identity/type and field-only paragraph properties.
const literalField = (field: XmlElement, content: string): XmlElement => {
  const pPr = firstChildElement(field, name("pPr"));
  return run(
    content,
    mergeProperties(
      pPr && firstChildElement(pPr, name("defRPr")),
      runProperties(field),
    ),
  );
};
const fragment = (node: XmlNode, content: string): XmlNode => {
  if (is(node, "fld")) return literalField(node, content);
  if (!is(node, "r")) return clone(node);
  const copy = clone(node),
    t = firstChildElement(copy, name("t"));
  if (t) t.children = content ? [text(content)] : [];
  return copy;
};

/** Split inline content without changing untouched nodes or native breaks. */
const split = (p: XmlElement, offset: number): [XmlNode[], XmlNode[]] => {
  const left: XmlNode[] = [],
    right: XmlNode[] = [];
  let at = 0;
  for (const node of inline(p)) {
    const content = value(node),
      end = at + content.length;
    if (end <= offset && (content.length || at < offset))
      left.push(clone(node));
    else if (at >= offset) right.push(clone(node));
    else {
      left.push(fragment(node, content.slice(0, offset - at)));
      right.push(fragment(node, content.slice(offset - at)));
    }
    at = end;
  }
  return [left, right];
};
const propertiesAt = (
  p: XmlElement,
  offset: number,
  replacing: boolean,
): XmlElement | null => {
  let at = 0,
    previous: XmlElement | null = null;
  const format = (node: XmlNode) =>
    runProperties(is(node, "fld") ? literalField(node, "") : node);
  for (const node of inline(p)) {
    const content = value(node),
      end = at + content.length;
    if (content.length && (offset < end || (offset === at && replacing))) {
      if (offset === at && !replacing && previous) return previous;
      return format(node);
    }
    if (end <= offset && content.length) {
      previous = format(node);
      // A soft break establishes the following line's character defaults.
      if (is(node, "br") && !previous) previous = null;
    }
    at = end;
  }
  const end = firstChildElement(p, name("endParaRPr"));
  // endParaRPr saves the character state for text inserted after the last
  // run (21.1.2.2.3); its declared values override the preceding run.
  return end ? mergeProperties(previous, end) : previous;
};
const paragraph = (
  template: XmlElement,
  children: XmlNode[],
  end: XmlElement | null,
): XmlElement => {
  const copy = clone(template),
    properties = firstChildElement(copy, name("pPr"));
  copy.children = [
    ...(properties ? [properties] : []),
    ...children,
    ...(end ? [clone(end)] : []),
  ];
  return copy;
};
const validBoundary = (s: string, offset: number) =>
  !(
    offset > 0 &&
    offset < s.length &&
    s.charCodeAt(offset - 1) >= 0xd800 &&
    s.charCodeAt(offset - 1) <= 0xdbff &&
    s.charCodeAt(offset) >= 0xdc00 &&
    s.charCodeAt(offset) <= 0xdfff
  );

/** Replace one selected native text range. Paragraph merges retain the leading
 * paragraph properties and trailing end-marker properties; inserted paragraphs
 * inherit the insertion paragraph. Unselected fields and opaque XML survive. */
export const editTextBodyRange = (
  body: XmlElement,
  edit: TextBodyEdit,
): void => {
  const before = textBodyText(body),
    { start, end } = edit;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > before.length ||
    !validBoundary(before, start) ||
    !validBoundary(before, end) ||
    typeof edit.text !== "string" ||
    (edit.breakKind !== undefined &&
      edit.breakKind !== "paragraph" &&
      edit.breakKind !== "line")
  )
    throw new RangeError("invalid native text edit range");
  if (start === end && edit.text === "") return;
  const inserted = edit.text.replace(/\r\n?/g, "\n");
  for (const c of inserted) {
    const n = c.codePointAt(0)!;
    if (!(
      n === 9 ||
      n === 10 ||
      (n >= 0x20 && n <= 0xd7ff) ||
      (n >= 0xe000 && n <= 0xfffd) ||
      (n >= 0x10000 && n <= 0x10ffff)
    ))
      throw new RangeError(
        "native text edit contains an invalid XML character",
      );
  }
  const original = paragraphsOf(body),
    ps = original.length ? [...original] : [elem(name("p"))];
  const locate = (offset: number) => {
    let at = 0;
    for (let i = 0; i < ps.length; i++) {
      const length = paragraphText(ps[i]!).length;
      if (offset <= at + length) return { index: i, offset: offset - at };
      at += length + 1;
    }
    throw new RangeError("invalid native text edit position");
  };
  const a = locate(start),
    b = locate(end),
    first = ps[a.index]!,
    last = ps[b.index]!;
  const prefix = split(first, a.offset)[0],
    suffix = split(last, b.offset)[1];
  const properties = propertiesAt(first, a.offset, end > start);
  const leadingEnd = firstChildElement(first, name("endParaRPr")),
    trailingEnd = firstChildElement(last, name("endParaRPr"));
  // Opaque zero-width siblings are metadata, not selected characters.
  const opaque: XmlNode[] = [];
  for (let i = a.index; i <= b.index; i++) {
    let at = 0;
    for (const n of inline(ps[i]!)) {
      const length = value(n).length;
      if (
        !length &&
        !is(n, "r") &&
        !is(n, "fld") &&
        (i > a.index || at >= a.offset) &&
        (i < b.index || at < b.offset)
      )
        opaque.push(clone(n));
      at += length;
    }
  }
  const parts = inserted.split("\n"),
    result: XmlElement[] = [];
  let children: XmlNode[] = [...prefix, ...opaque];
  parts.forEach((part, i) => {
    if (part) children.push(run(part, properties));
    if (i < parts.length - 1) {
      if (edit.breakKind === "line")
        children.push(
          elem(name("br"), { children: properties ? [clone(properties)] : [] }),
        );
      else {
        const marker = properties
          ? { ...clone(properties), name: name("endParaRPr") }
          : leadingEnd;
        result.push(paragraph(first, children, marker));
        children = [];
      }
    }
  });
  children.push(...suffix);
  const emptyTail =
    parts.length > 1 &&
    edit.breakKind !== "line" &&
    !suffix.some((n) => value(n).length);
  const marker =
    emptyTail && properties
      ? { ...clone(properties), name: name("endParaRPr") }
      : trailingEnd;
  result.push(paragraph(first, children, marker));
  const selected = new Set(ps.slice(a.index, b.index + 1));
  if (!original.length) body.children.push(...result);
  else {
    let added = false;
    body.children = body.children.flatMap((n) => {
      if (n.kind !== "element" || !selected.has(n)) return [n];
      if (added) return [];
      added = true;
      return result;
    });
  }
};
