import { parseXml, type XmlDocument, type XmlElement } from "../xml/index.ts";
import type { Part } from "./package.ts";

const decoder = new TextDecoder();
const cache = new WeakMap<Part, { data: Uint8Array; document: XmlDocument }>();

const readOnlyPartDocument = (part: Part): XmlDocument => {
  const hit = cache.get(part);
  if (hit?.data === part.data) return hit.document;
  const document = parseXml(decoder.decode(part.data));
  cache.set(part, { data: part.data, document });
  return document;
};

/**
 * Shared XML for internal, read-only consumers of package parts. Never expose
 * this tree through mutable handles or edit it: writers must use an independent
 * document and replace the part's bytes when committing. Part identity isolates
 * packages; byte replacement invalidates reads. Relationships remain live.
 */
export const readOnlyPartRoot = (part: Part): XmlElement =>
  readOnlyPartDocument(part).root;

const cloneElement = (el: XmlElement): XmlElement => ({
  kind: "element",
  name: { ...el.name },
  attrs: el.attrs.map((a) => ({ name: { ...a.name }, value: a.value })),
  prefixDecls: new Map(el.prefixDecls),
  children: el.children.map((c) =>
    c.kind === "element" ? cloneElement(c) : { ...c },
  ),
});

/**
 * Template shape handles need independent mutable trees. Copying the parsed
 * document avoids reparsing large layout geometry for every rendered slide
 * without exposing the shared read-only tree through these handles.
 */
export const copyPartDocument = (part: Part): XmlDocument => {
  const doc = readOnlyPartDocument(part);
  return {
    kind: "document",
    decl: doc.decl && { ...doc.decl },
    root: cloneElement(doc.root),
    prolog: doc.prolog.map((n) => ({ ...n })),
    epilog: doc.epilog.map((n) => ({ ...n })),
  };
};
