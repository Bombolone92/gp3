import { themeForSlide } from "../lib/pptx/src/api/fn/shape-theme.ts";
import { resolveThemeTypeface } from "../lib/pptx/src/api/fn/theme.ts";
import {
  documentFontAlias,
  documentFontDescriptor,
} from "./document-font-resources.js";
import {
  _internalPackageOf,
  getSlideLayout,
  getSlideLayouts,
  getSlidePartName,
  getSlides,
} from "../lib/pptx/src/index.ts";

const SLIDE_DOCUMENT = Symbol.for("@office-kit/pptx.slide.document");
const LAYOUT_PART = Symbol.for("@office-kit/pptx.layout.part");
const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const THEME_FONT = /^\+m[jn]-(lt|ea|cs)$/;
const LAYOUT_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const layoutFontCache = new WeakMap();
const slideFontCache = new WeakMap();
const sharedSlideFontCache = new WeakMap();
// Decorative paths can contain thousands of points; font declarations
// live in text, not in geometry, fills, effects, or nonvisual properties.
const NON_TEXT = new Set([
  "spPr",
  "grpSpPr",
  "blipFill",
  "extLst",
  "nvSpPr",
  "nvPicPr",
  "nvCxnSpPr",
  "nvGrpSpPr",
  "nvGraphicFramePr",
]);
const FALLBACKS = {
  serif: 'Georgia, "Times New Roman", serif',
  thinSerif: '"Bodoni 72", Didot, "Times New Roman", serif',
  sans: "Arial, Helvetica, sans-serif",
  mono: '"Courier New", monospace',
  script: '"Snell Roundhand", "Segoe Script", "Brush Script MT", cursive',
  brush: '"Brush Script MT", "Segoe Script", cursive',
  narrowScript: '"Savoye LET", "Snell Roundhand", "Segoe Script", cursive',
  decorative: "fantasy",
};

// DrawingML pitchFamily uses LOGFONT's family bits. PANOSE can also
// identify a serif or monospaced face when pitchFamily is unspecified.
// https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-logfontw
// https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-panose
function fontKind(attrs) {
  const pitch = Number(attrs.pitchFamily);
  let kind;
  if (Number.isInteger(pitch) && pitch >= 0 && pitch <= 255) {
    if ((pitch & 3) === 1) return "mono";
    kind = {
      16: "serif",
      32: "sans",
      48: "mono",
      64: "script",
      80: "decorative",
    }[pitch & 240];
    if (kind && kind !== "serif" && kind !== "script") return kind;
  }
  const panose = attrs.panose || "";
  if (!/^[0-9a-f]{20}$/i.test(panose)) return kind || null;
  // Read only the PANOSE fields needed to classify the fallback.
  const family = panose.slice(0, 2);
  const form = parseInt(panose.slice(2, 4), 16);
  // Serif style 7 identifies thin serifs, as in modern Bodoni faces.
  if (kind === "serif")
    return family === "02" && form === 7 ? "thinSerif" : "serif";
  if (kind === "script" || family === "03") {
    // Hand Written tools 6–9 are brush/rough/felt-tip lettering.
    // https://monotype.github.io/panose/pan3.htm
    if (family !== "03") return "script";
    if (form >= 6 && form <= 9) return "brush";
    const aspect = panose.slice(8, 10);
    return aspect === "02" || aspect === "03" ? "narrowScript" : "script";
  }
  if (family === "02") {
    if (panose.slice(6, 8) === "09") return "mono";
    if (form >= 2 && form <= 10) return form === 7 ? "thinSerif" : "serif";
    if (form >= 11 && form <= 15) return "sans";
  }
  return family === "04" ? "decorative" : null;
}

const FONT_PARENT = {
  brush: "script",
  narrowScript: "script",
  thinSerif: "serif",
};
function mergeFontKinds(first, second) {
  if (first === undefined) return second;
  if (second === undefined || first === second) return first;
  // A generic family and a more specific declaration of it agree.
  if (FONT_PARENT[first] === second) return first;
  if (FONT_PARENT[second] === first) return second;
  return null;
}

function addFont(attrs, fonts, consensus) {
  const kind = fontKind(attrs);
  if (attrs.typeface && !THEME_FONT.test(attrs.typeface) && kind) {
    const key = attrs.typeface.trim().toLowerCase();
    const previous = fonts.get(key);
    fonts.set(
      key,
      consensus
        ? mergeFontKinds(previous, kind)
        : FONT_PARENT[previous] === kind
          ? previous
          : kind,
    );
  }
}

// Native XML parsing avoids constructing the library's geometry model for
// unused layouts. The browser only needs the font declarations here.
function collectLayoutFontParts(parts, fonts, key) {
  const requested = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const parser = new DOMParser();
  const decoder = new TextDecoder();
  for (const part of parts) {
    const xml = decoder.decode(part.data);
    if (!/\b(?:pitchFamily|panose)\s*=/.test(xml)) continue;
    // This is only a conservative prefilter. The XML parser below owns
    // namespaces, attributes, entities, and declaration validity.
    if (
      !requested.test(xml) &&
      !/\btypeface\s*=\s*(?:"[^"]*&[^"]*"|'[^']*&[^']*')/.test(xml)
    )
      continue;
    const root = parser.parseFromString(xml, "application/xml");
    if (root.getElementsByTagName("parsererror").length) continue;
    for (const node of root.querySelectorAll("[pitchFamily], [panose]")) {
      if (
        node.namespaceURI !== DRAWING_NS ||
        !["latin", "ea", "cs", "sym", "buFont"].includes(node.localName)
      )
        continue;
      let parent = node.parentElement;
      while (parent && !NON_TEXT.has(parent.localName))
        parent = parent.parentElement;
      if (parent) continue;
      addFont(
        {
          typeface: node.getAttribute("typeface"),
          pitchFamily: node.getAttribute("pitchFamily"),
          panose: node.getAttribute("panose"),
        },
        fonts,
        true,
      );
    }
  }
}

function collectFonts(root, fonts, consensus = false) {
  if (!root) return;
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (
      node.name?.namespaceURI === DRAWING_NS &&
      ["latin", "ea", "cs", "sym", "buFont"].includes(node.name.localName)
    ) {
      const attrs = Object.fromEntries(
        (node.attrs || [])
          .filter((a) => !a.name.namespaceURI)
          .map((a) => [a.name.localName, a.value]),
      );
      addFont(attrs, fonts, consensus);
    }
    for (const child of node.children || [])
      if (child.kind === "element" && !NON_TEXT.has(child.name.localName))
        pending.push(child);
  }
}

// A deck may classify a typeface in just one layout. Reuse that hint
// when the current slide omits it, but do not guess from conflicting hints.
// Cache by package and layout bytes: edits/imports invalidate the index,
// while slide edits and repeated previews do not reparse every layout.
function layoutFontKind(pres, key) {
  const pkg = _internalPackageOf(pres);
  const parts = pkg.parts.filter((p) => p.contentType === LAYOUT_CONTENT_TYPE);
  let cached = layoutFontCache.get(pkg);
  if (
    !cached ||
    cached.parts.length !== parts.length ||
    !parts.every(
      (p, i) =>
        p.name === cached.parts[i].name && p.data === cached.parts[i].data,
    )
  ) {
    cached = {
      parts: parts.map(({ name, data }) => ({ name, data })),
      fonts: new Map(),
    };
    layoutFontCache.set(pkg, cached);
  }
  if (!cached.fonts.has(key) && !cached.complete) {
    const fonts = new Map();
    try {
      if (typeof DOMParser === "function")
        collectLayoutFontParts(parts, fonts, key);
      else {
        for (const layout of getSlideLayouts(pres))
          collectFonts(layout[LAYOUT_PART]?.root, fonts, true);
        cached.fonts = fonts;
        cached.complete = true;
      }
    } catch {
      // An unused, damaged layout must not prevent a valid slide rendering.
      fonts.clear();
    }
    cached.fonts.set(key, fonts.get(key));
  }
  return cached.fonts.get(key);
}

// Slide roots are mutated in place by edits. The committed part's byte buffer
// is the revision marker, so a changed slide is rescanned while all unchanged
// slides keep their small font maps. Pictures and geometry are never parsed.
function sharedSlideFontKind(pres, key) {
  const pkg = _internalPackageOf(pres);
  const slides = getSlides(pres);
  const revision = (slide) => pkg.getPart(getSlidePartName(slide))?.data;
  let cached = sharedSlideFontCache.get(pkg);
  if (
    !cached ||
    cached.slides.length !== slides.length ||
    !slides.every(
      (slide, i) =>
        cached.slides[i].slide === slide &&
        cached.slides[i].data === revision(slide),
    )
  ) {
    const fonts = new Map();
    const entries = slides.map((slide) => {
      const data = revision(slide);
      let hints = slideFontCache.get(slide);
      if (!hints || hints.data !== data) {
        const local = new Map();
        collectFonts(slide[SLIDE_DOCUMENT]?.root, local, true);
        hints = { data, fonts: local };
        slideFontCache.set(slide, hints);
      }
      for (const [name, kind] of hints.fonts) {
        fonts.set(name, mergeFontKinds(fonts.get(name), kind));
      }
      return { slide, data };
    });
    cached = { slides: entries, fonts };
    sharedSlideFontCache.set(pkg, cached);
  }
  return cached.fonts.get(key);
}

function sharedFontKind(pres, key) {
  const layoutKind = layoutFontKind(pres, key);
  const slideKind = sharedSlideFontKind(pres, key);
  // undefined means no declaration; null means conflicting declarations.
  // A conflict in either source must not become a guess from the other one.
  return mergeFontKinds(layoutKind, slideKind);
}

// A typeface is one CSS string, not an untrusted CSS family list. The SVG
// renderer subsequently XML-escapes it. Installed or packaged faces win,
// followed by a similar system fallback when that family is unavailable.
export const quoteFamily = (family) =>
  `"${family.replace(/[\\"\x00-\x1f\x7f]/g, (c) => `\\${c.codePointAt(0).toString(16)} `)}"`;

export function slideFontResolver(slide, pres) {
  let fonts;
  // Photos and common system fonts need no metadata lookup. For an
  // unfamiliar face, inspect the current slide and its layout once for
  // this render, so subsequent edits cannot reuse stale declarations.
  const declaredKind = (key, layout) => {
    if (!fonts) {
      fonts = new Map();
      // Preview supplies its already parsed layout. The canvas editor can
      // resolve it on demand when an unfamiliar font needs a fallback.
      collectFonts(
        (layout === undefined ? getSlideLayout(slide) : layout)?.[LAYOUT_PART]
          ?.root,
        fonts,
      );
      collectFonts(slide[SLIDE_DOCUMENT]?.root, fonts);
    }
    if (fonts.has(key)) return fonts.get(key);
    const native = pres && documentFontDescriptor(pres, key);
    if (native) {
      const kind = fontKind(native);
      if (kind) return kind;
    }
    if (pres) {
      return sharedFontKind(pres, key);
    }
    return null;
  };
  const resolved = new Map();
  return (family, layout) => {
    const authored = typeof family === "string" ? family.trim() : "";
    const name = THEME_FONT.test(authored)
      ? resolveThemeTypeface(authored, themeForSlide(slide)?.fonts)
      : authored;
    if (!name) return FALLBACKS.sans;
    if (resolved.has(name)) return resolved.get(name);
    const key = name.toLowerCase();
    const kind =
      /^(cambria|caladea|liberation serif|times|georgia|garamond|palatino|book antiqua|baskerville)(\s|$)/.test(
        key,
      )
        ? "serif"
        : /^(courier|consolas|liberation mono|menlo|monaco)(\s|$)/.test(key)
          ? "mono"
          : /^(arial|helvetica|calibri|carlito|aptos|verdana|tahoma|trebuchet ms|segoe ui|impact|liberation sans)(\s|$)/.test(
                key,
              )
            ? "sans"
            : declaredKind(key, layout) || "sans";
    // Broadway is an upright ornamental display face. A platform's fantasy
    // default can be handwriting (Papyrus on macOS), which loses that form.
    // https://learn.microsoft.com/en-us/typography/font-list/broadway
    const fallback =
      key === "broadway" ? 'Rockwell, "Arial Black", fantasy' : FALLBACKS[kind];
    const alias = pres && documentFontAlias(pres, name);
    const value = `${alias ? `${quoteFamily(alias)}, ` : ""}${quoteFamily(name)}, ${fallback}`;
    resolved.set(name, value);
    return value;
  };
}
