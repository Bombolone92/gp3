// Copy the styles actually used by imported tables into their inline style
// slots. This avoids GUID collisions and retains source formatting through
// the temporary presentation used by the editor's clipboard.
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  qname,
} from "../../internal/xml/index.ts";
import { INTERNAL_PACKAGE, type SlideData } from "../_internal-symbols.ts";
import { getEffectiveColorMap } from "./color-map.ts";
import { themeForSlide } from "./shape-theme.ts";
import { resolveDrawingColor, resolveDrawingOpacity } from "./shape-color.ts";
import { tableStyleDefinition } from "./table-styles.ts";

const child = (el: XmlElement | null, local: string): XmlElement | null =>
  el ? firstChildElement(el, qname("a", local, NS.dml)) : null;
const value = (el: XmlElement | null, local: string): string | null =>
  el ? getAttrValue(el, qname("", local, "")) : null;
const elements = (el: XmlElement | null): XmlElement[] =>
  el?.children.filter(
    (c): c is XmlElement =>
      c.kind === "element" && c.name.namespaceURI === NS.dml,
  ) ?? [];
const COLORS = new Set([
  "srgbClr",
  "scrgbClr",
  "hslClr",
  "schemeClr",
  "sysClr",
  "prstClr",
]);
const colorChild = (el: XmlElement | null): XmlElement | null =>
  elements(el).find((c) => COLORS.has(c.name.localName)) ?? null;

const newStyleId = (): string => {
  // getRandomValues also works in non-secure browser contexts, unlike
  // randomUUID. Use a version-4 UUID in DrawingML's uppercase ST_Guid form.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
};

export const preserveImportedTableStyles = (
  source: SlideData,
  root: XmlElement,
): boolean => {
  const tables: XmlElement[] = [];
  const visit = (el: XmlElement): void => {
    if (el.name.namespaceURI === NS.dml && el.name.localName === "tbl")
      tables.push(el);
    else for (const c of el.children) if (c.kind === "element") visit(c);
  };
  visit(root);
  if (!tables.length) return false;
  const pkg = source[INTERNAL_PACKAGE];
  const map = getEffectiveColorMap(source);
  const themeView = themeForSlide(source);
  const theme = themeView?.theme ?? null;
  const fonts = themeView?.fonts ?? null;
  const themeElements = child(themeView?.root ?? null, "themeElements"),
    matrix = child(themeElements, "fmtScheme"),
    fontScheme = child(themeElements, "fontScheme");
  const freezeColor = (
    el: XmlElement,
    placeholder: XmlElement | null,
  ): XmlElement => {
    let sourceColor = el;
    if (
      el.name.localName === "schemeClr" &&
      value(el, "val") === "phClr" &&
      placeholder
    ) {
      const base = freezeColor(placeholder, null);
      if (base.name.localName === "srgbClr")
        sourceColor = { ...base, children: [...base.children, ...el.children] };
    }
    const hex = resolveDrawingColor(sourceColor, theme, map);
    if (!hex) return structuredClone(el);
    const opacity = resolveDrawingOpacity(sourceColor);
    return elem(qname("a", "srgbClr", NS.dml), {
      attrs: [attr(qname("", "val", ""), hex.slice(1))],
      children:
        opacity === 1
          ? []
          : [
              elem(qname("a", "alpha", NS.dml), {
                attrs: [
                  attr(
                    qname("", "val", ""),
                    String(Math.round(opacity * 100000)),
                  ),
                ],
              }),
            ],
    });
  };
  const bake = (
    el: XmlElement,
    placeholder: XmlElement | null = null,
  ): XmlElement => {
    if (el.name.namespaceURI !== NS.dml) return structuredClone(el);
    const local = el.name.localName;
    if (COLORS.has(local)) return freezeColor(el, placeholder);
    if (local === "fillRef" || local === "lnRef") {
      const index = Number(value(el, "idx")),
        refColor = colorChild(el);
      const isFill = local === "fillRef";
      const list = child(
        matrix,
        isFill
          ? index > 1000
            ? "bgFillStyleLst"
            : "fillStyleLst"
          : "lnStyleLst",
      );
      const selected =
        elements(list)[isFill && index > 1000 ? index - 1001 : index - 1];
      if (index === 0 || (isFill && index === 1000))
        return elem(qname("a", isFill ? "fill" : "ln", NS.dml), {
          children: [elem(qname("a", "noFill", NS.dml))],
        });
      if (selected) {
        const resolved = bake(selected, refColor);
        return isFill
          ? elem(qname("a", "fill", NS.dml), { children: [resolved] })
          : resolved;
      }
    }
    if (local === "fontRef") {
      const kind = value(el, "idx"),
        collection =
          kind === "major" || kind === "minor"
            ? child(fontScheme, kind + "Font")
            : null;
      if (collection) {
        const copy = structuredClone(collection);
        copy.name = qname("a", "font", NS.dml);
        return copy;
      }
    }
    const copy: XmlElement = {
      ...el,
      attrs: el.attrs.map((a) => ({ ...a })),
      children: el.children.map((c) =>
        c.kind === "element" ? bake(c, placeholder) : { ...c },
      ),
    };
    if (local === "tcTxStyle" && !colorChild(el)) {
      const fallback = colorChild(child(el, "fontRef"));
      if (fallback) {
        const color = freezeColor(fallback, null);
        const ext = copy.children.findIndex(
          (c) =>
            c.kind === "element" &&
            c.name.namespaceURI === NS.dml &&
            c.name.localName === "extLst",
        );
        copy.children.splice(ext < 0 ? copy.children.length : ext, 0, color);
      }
    }
    if (local === "latin" || local === "ea" || local === "cs") {
      const name = value(el, "typeface");
      const slots: Record<string, string | null | undefined> = {
        "+mj-lt": fonts?.majorLatin,
        "+mn-lt": fonts?.minorLatin,
        "+mj-ea": fonts?.majorEastAsian,
        "+mn-ea": fonts?.minorEastAsian,
        "+mj-cs": fonts?.majorComplexScript,
        "+mn-cs": fonts?.minorComplexScript,
      };
      const resolved = name ? slots[name] : null;
      if (resolved)
        copy.attrs = copy.attrs.map((a) =>
          a.name.namespaceURI === "" && a.name.localName === "typeface"
            ? { ...a, value: resolved }
            : a,
        );
    }
    return copy;
  };
  let changed = false;
  for (const table of tables) {
    const properties = child(table, "tblPr"),
      definition = tableStyleDefinition(pkg, properties);
    const copy = bake(table),
      copyProperties =
        child(copy, "tblPr") ?? elem(qname("a", "tblPr", NS.dml));
    if (!child(copy, "tblPr")) copy.children.unshift(copyProperties);
    copyProperties.children = copyProperties.children.filter(
      (c) =>
        !(
          c.kind === "element" &&
          c.name.namespaceURI === NS.dml &&
          (c.name.localName === "tableStyleId" ||
            c.name.localName === "tableStyle")
        ),
    );
    const inline = bake(definition);
    inline.name = qname("a", "tableStyle", NS.dml);
    // Keep Source Formatting preserves a table's implicit minor font, while
    // its implicit text color and master paragraph defaults follow the target.
    // Put the font at the base of the style cascade so conditional table
    // regions and authored cell/paragraph/run fonts can still override it.
    const minorFont = child(fontScheme, "minorFont");
    if (minorFont) {
      let whole = child(inline, "wholeTbl");
      if (!whole) {
        whole = elem(qname("a", "wholeTbl", NS.dml));
        const background = inline.children.findIndex(
          (c) =>
            c.kind === "element" &&
            c.name.namespaceURI === NS.dml &&
            c.name.localName === "tblBg",
        );
        inline.children.splice(background + 1, 0, whole);
      }
      let text = child(whole, "tcTxStyle");
      if (!text) {
        text = elem(qname("a", "tcTxStyle", NS.dml));
        whole.children.unshift(text);
      }
      const fontRef = child(text, "fontRef");
      if (
        !child(text, "font") &&
        (!fontRef || value(fontRef, "idx") === "none")
      ) {
        // A "none" reference still uses the table's implicit font. Its
        // color, if any, was already preserved as a sibling by bake().
        if (fontRef) text.children = text.children.filter((c) => c !== fontRef);
        const font = bake(minorFont);
        font.name = qname("a", "font", NS.dml);
        text.children.unshift(font);
      }
    }
    // Readers identify even inline styles by GUID across the deck. A
    // source ID can already denote another definition in the target, and
    // baking theme references creates a new definition even for built-ins.
    // Give the imported definition its own identity; reusing the source ID
    // makes readers silently apply the first imported style to later tables.
    inline.attrs = inline.attrs.filter(
      (a) => a.name.namespaceURI !== "" || a.name.localName !== "styleId",
    );
    inline.attrs.push(attr(qname("", "styleId", ""), newStyleId()));
    // The inline style or style ID is the final child of CT_TableProperties.
    copyProperties.children.push(inline);
    table.attrs = copy.attrs;
    table.children = copy.children;
    changed = true;
  }
  return changed;
};
