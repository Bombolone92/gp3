// XML parsing for untrusted Office parts. Office Open XML never uses document
// type declarations, so any DOCTYPE or ENTITY declaration is rejected before
// parsing: no external entities, no entity expansion.
export const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  s: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  rel: "http://schemas.openxmlformats.org/package/2006/relationships",
};

export function parseXML(text, Parser = globalThis.DOMParser) {
  if (typeof text !== "string") throw Error("This document is incomplete.");
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error("This document contains unsupported XML declarations.");
  if (!Parser) throw Error("XML parsing is unavailable in this browser.");
  const doc = new Parser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw Error("This document is damaged or is not a supported format.");
  return doc;
}

// Namespaced lookups tolerate prefixes that differ from the conventional ones.
export const all = (node, ns, name) =>
  node ? Array.from(node.getElementsByTagNameNS(ns, name)) : [];
export const first = (node, ns, name) =>
  node?.getElementsByTagNameNS(ns, name)[0] || null;
export const children = (node, ns, name) =>
  node
    ? Array.from(node.childNodes).filter(
        (c) =>
          c.nodeType === 1 &&
          c.namespaceURI === ns &&
          (!name || c.localName === name),
      )
    : [];
export const attr = (node, ns, name) =>
  node
    ? ns
      ? node.getAttributeNS(ns, name) || ""
      : node.getAttribute(name) || ""
    : "";

// Relationship ID to target part, resolved against the owning part.
export function relationships(doc, resolve) {
  const map = new Map();
  if (!doc) return map;
  for (const rel of all(doc, NS.rel, "Relationship")) {
    if (rel.getAttribute("TargetMode") === "External") continue;
    const target = resolve(rel.getAttribute("Target"));
    if (target)
      map.set(rel.getAttribute("Id"), {
        target,
        type: rel.getAttribute("Type") || "",
      });
  }
  return map;
}
