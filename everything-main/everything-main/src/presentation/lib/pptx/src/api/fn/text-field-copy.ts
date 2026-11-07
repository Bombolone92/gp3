import type { OpcPackage, Part } from "../../internal/parts/index.ts";
import {
  NS,
  type XmlElement,
  getAttrValue,
  parseXml,
  qname,
  serializeXml,
  walkElements,
} from "../../internal/xml/index.ts";

const ID = qname("", "id", "");
const guid = /^\{[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\}$/i;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const newId = () => {
  // getRandomValues works in non-secure browser contexts too. ST_Guid uses
  // uppercase hexadecimal in braces; the token is a version-4 UUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
};
const fields = (root: XmlElement) => {
  const result: XmlElement[] = [];
  walkElements(root, (el) => {
    if (el.name.namespaceURI === NS.dml && el.name.localName === "fld")
      result.push(el);
  });
  return result;
};
const fieldDocument = (part: Readonly<Part>) => {
  if (!/(?:\+xml|\/xml)$/.test(part.contentType)) return null;
  const xml = decoder.decode(part.data);
  if (!/[:<]fld(?=[\s/>])/.test(xml)) return null;
  try {
    return parseXml(xml);
  } catch {
    // Optional unreadable XML remains opaque, as on the graph-copy path.
    return null;
  }
};

/** One logical copy shares a mapping across the body and dependency graph.
 * fld@id is unique in its host document (21.1.2.2.4). Retain non-conflicting
 * tokens; rebase collisions consistently in semantic data and saved drawings.
 * https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.field
 */
export const createTextFieldCopy = (target: OpcPackage): TextFieldCopy => {
  // Snapshot immutable byte buffers before copying starts. Reserve lazily so
  // copying an object with no fields does not parse the destination deck.
  const original = target.parts.map((part) => ({ ...part }));
  let reserved: Set<string> | null = null;
  // Sibling logical copies reserve together but have independent mappings.
  const context = (): TextFieldCopy => {
    const mapping = new Map<string, string>();
    const rewrite = (root: XmlElement): boolean => {
      let changed = false;
      for (const field of fields(root)) {
        const id = getAttrValue(field, ID);
        // Preserve malformed/missing identities rather than silently repairing
        // unrelated source XML. Foreign lookalikes are not DrawingML fields.
        if (!id || !guid.test(id)) continue;
        if (!reserved) {
          reserved = new Set();
          for (const part of original) {
            const doc = fieldDocument(part);
            if (!doc) continue;
            for (const el of fields(doc.root)) {
              const token = getAttrValue(el, ID);
              if (token && guid.test(token)) reserved.add(token.toUpperCase());
            }
          }
        }
        const key = id.toUpperCase();
        let next = mapping.get(key);
        if (!next) {
          next = id;
          if (reserved.has(key))
            do {
              next = newId();
            } while (reserved.has(next));
          reserved.add(next.toUpperCase());
          mapping.set(key, next);
        }
        if (next !== id) {
          field.attrs = field.attrs.map((a) =>
            a.name.namespaceURI === "" && a.name.localName === "id"
              ? { ...a, value: next }
              : a,
          );
          changed = true;
        }
      }
      return changed;
    };
    return {
      rewrite,
      fork: context,
      bytes(part: Readonly<Part>): Uint8Array {
        const doc = fieldDocument(part);
        return doc && rewrite(doc.root)
          ? encoder.encode(serializeXml(doc))
          : part.data;
      },
    };
  };
  return context();
};
export type TextFieldCopy = {
  rewrite(root: XmlElement): boolean;
  bytes(part: Readonly<Part>): Uint8Array;
  fork(): TextFieldCopy;
};
