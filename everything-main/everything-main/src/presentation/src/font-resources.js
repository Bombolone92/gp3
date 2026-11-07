import { _internalPackageOf } from "../lib/pptx/src/index.ts";
import {
  NS,
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";

// Exact, licensed faces available with the app. This catalog is independent of
// presentations and supplies the same family for measuring, editing and SVGs.
// Installed fonts retain priority. Assets are fetched only for referenced,
// unavailable families; no presentation content is sent to a font service.
import catalog from "./font-catalog.js";
import { quoteFamily } from "./fonts.js";
import {
  prepareDocumentFonts,
  declaresDocumentFont,
  hasDocumentFonts,
  documentFontStyles,
  documentFontKerning,
} from "./document-font-resources.js";
const known = new Map(
  catalog.map((entry) => [entry.family.toLowerCase(), entry]),
);
const packagedNames = new RegExp(
  catalog
    .map(({ family }) => family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "i",
);
const resources = new Map();
const pending = new Map();
const declarations = new WeakMap();
const fontNodes = new Set(["latin", "ea", "cs", "sym", "buFont", "font"]);
const familyKey = (family) =>
  String(family ?? "")
    .trim()
    .toLowerCase();

export function presentationFontFamilies(pres, packagedOnly = false) {
  const result = new Set();
  const decoder = new TextDecoder();
  for (const part of _internalPackageOf(pres).parts) {
    if (
      !part.contentType?.endsWith("+xml") &&
      part.contentType !== "application/xml"
    )
      continue;
    let families = declarations.get(part.data);
    if (!families) {
      families = new Set();
      const xml = decoder.decode(part.data);
      // Ordinary system-font decks need no XML tree construction. An entity
      // anywhere in a typeface can spell a packaged name, so keep those parts
      // for the namespace-aware reader even without a literal catalog match.
      if (
        packagedOnly &&
        !packagedNames.test(xml) &&
        !/\btypeface\s*=\s*(?:"[^"]*&[^"]*"|'[^']*&[^']*')/.test(xml)
      )
        continue;
      // A conservative prefilter only; namespace and entity handling belong
      // to the XML reader. Most package parts contain no font declarations.
      if (xml.includes("typeface")) {
        try {
          walkElements(parseXml(xml).root, (node) => {
            if (
              node.name.namespaceURI !== NS.dml ||
              !fontNodes.has(node.name.localName)
            )
              return;
            const family = getAttrValue(
              node,
              qname("", "typeface", ""),
            )?.trim();
            if (family && !/^\+m[jn]-(lt|ea|cs)$/.test(family))
              families.add(family);
          });
        } catch {
          // An unused malformed part must not prevent opening valid slides.
        }
      }
      declarations.set(part.data, families);
    }
    for (const family of families) result.add(family);
  }
  return result;
}

const toBase64 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};

async function loadFamily(entry) {
  // FontFace(local()) really resolves a local face. FontFaceSet.check() can
  // report success for an unknown family which merely falls back to a default.
  try {
    await new FontFace(
      "Presentation local font probe",
      `local(${JSON.stringify(entry.family)})`,
    ).load();
    return false;
  } catch {
    /* This family needs the packaged resource. */
  }
  const faces = await Promise.all(
    entry.faces.map(async ({ style, weight, url, variable, legacyKerning }) => {
      // Native reference controls use legacy kern for static faces, GPOS for variable
      // faces. A static GPOS-only face therefore has no native pair kerning.
      // Keep other GPOS positioning (e.g. combining marks) intact. Applying
      // this descriptor sets the default; resolveFontKerning also supplies an
      // explicit value because engines differ in descriptor precedence.
      const featureSettings =
        !variable && !legacyKerning ? '"kern" 0' : "normal";
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Font resource unavailable: ${response.status}`);
      const bytes = await response.arrayBuffer();
      const face = new FontFace(entry.family, bytes, {
        style,
        weight,
        featureSettings,
      });
      await face.load();
      return {
        face,
        style,
        weight,
        featureSettings,
        data: toBase64(new Uint8Array(bytes)),
      };
    }),
  );
  // Publish a complete family together; a failed download must not leave the
  // editor and its SVG images using different faces of a partial family.
  for (const { face } of faces) document.fonts.add(face);
  resources.set(familyKey(entry.family), { ...entry, faces });
  return true;
}

export async function preparePresentationFonts(pres, options = {}) {
  if (!globalThis.document?.fonts || typeof globalThis.FontFace !== "function")
    return false;
  const nativeChanged = await prepareDocumentFonts(pres, options);
  const jobs = [];
  for (const family of presentationFontFamilies(pres, true)) {
    const key = familyKey(family),
      entry = known.get(key);
    if (!entry || resources.has(key) || declaresDocumentFont(pres, family))
      continue;
    let job = pending.get(key);
    if (!job) {
      job = loadFamily(entry).catch(() => {
        pending.delete(key);
        return false;
      });
      pending.set(key, job);
    }
    jobs.push(job);
  }
  return (await Promise.all(jobs)).some(Boolean) || nativeChanged;
}

export function embeddedFontStyles(faces, pres = null) {
  const rules = [];
  const included = new Set();
  for (const [family, styles] of faces) {
    if (pres && declaresDocumentFont(pres, family)) continue;
    const resource = resources.get(familyKey(family));
    if (!resource) continue;
    for (const face of resource.faces) {
      if (!styles.has(face.style)) continue;
      const key = `${resource.family}/${face.style}/${face.weight}`;
      if (included.has(key)) continue;
      included.add(key);
      rules.push(
        `@font-face{font-family:${JSON.stringify(resource.family)};font-style:${face.style};font-weight:${face.weight};font-feature-settings:${face.featureSettings};src:url(data:font/woff2;base64,${face.data}) format("woff2")}`,
      );
    }
  }
  return rules.join("") + (pres ? documentFontStyles(faces, pres) : "");
}

export const hasFontResources = (pres = null) =>
  resources.size > 0 || (pres && hasDocumentFonts(pres));

// Accept authored names and the CSS stacks produced by slideFontResolver.
// Only loaded resources have known capabilities; installed fonts and unknown
// fallbacks keep the caller's kerning. Never infer capabilities from a name.
export function resolveFontKerning(spec) {
  const native = documentFontKerning(spec);
  if (native !== undefined) return native;
  if (!resources.size || spec.kerning === "none") return spec.kerning;
  const key = familyKey(spec.family);
  let resource = resources.get(key);
  if (!resource)
    for (const entry of resources.values()) {
      const quoted = quoteFamily(entry.family).toLowerCase();
      if (key === quoted || key.startsWith(`${quoted},`)) {
        resource = entry;
        break;
      }
    }
  const face = resource?.faces.find(
    (face) =>
      face.style === (spec.italic ? "italic" : "normal") &&
      face.weight === (spec.bold ? "700" : "400"),
  );
  return face?.featureSettings === '"kern" 0' ? "none" : spec.kerning;
}
