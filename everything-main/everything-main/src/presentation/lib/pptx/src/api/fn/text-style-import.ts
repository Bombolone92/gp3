// Copy text formatting at the boundary where its source template is replaced.
// Preserve raw DrawingML properties, including properties the editor does not
// expose. Do not turn text into pictures or alter runs, fields, or field IDs.
import {
  type PartName,
  type Relationships,
  nextRelId,
  resolveTarget,
} from "../../internal/opc/index.ts";
import { type OpcPackage } from "../../internal/parts/index.ts";
import { copyPartGraph } from "../../internal/parts/copy-graph.ts";
import {
  readGroupChildren,
  readShapeTreeFromCsldRoot,
} from "../../internal/presentationml/index.ts";
import {
  NS,
  attr,
  elem,
  getAttrValue,
  qname,
  type XmlAttr,
  type XmlElement,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SLIDE_PART_NAME,
  SLIDE_SHAPES,
  type SlideData,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { getEffectiveColorMap, resolveDeckBodyTextColor } from "./color-map.ts";
import {
  getGroupChildren,
  getShapePlaceholderType,
  isShapePlaceholder,
  isShapeTextBox,
} from "./shape-read-base.ts";
import { resolveDrawingColor } from "./shape-color.ts";
import { themeForShape } from "./shape-theme.ts";
import { resolveThemeTypeface } from "./theme.ts";
import {
  bodyPropertySources,
  drawingChild,
  listStyleLevel,
  textBody,
  textBodySources,
  textListStyleSources,
  textFontReferenceDefaults,
  type TextInheritanceSource,
} from "./text-inheritance.ts";
import { sharedFontDescriptors } from "./shared-font-descriptors.ts";

const value = (el: XmlElement, local: string) =>
  getAttrValue(el, qname("", local, ""));
const key = (el: XmlElement | XmlAttr) =>
  `${el.name.namespaceURI}|${el.name.localName}`;
const elements = (el: XmlElement) =>
  el.children.filter((c): c is XmlElement => c.kind === "element");
const rGroups = [
  "ln",
  "noFill solidFill gradFill blipFill pattFill grpFill",
  "effectLst effectDag",
  "highlight",
  "uLnTx uLn",
  "uFillTx uFill",
  "latin",
  "ea",
  "cs",
  "sym",
  "hlinkClick",
  "hlinkMouseOver",
  "rtl",
  "extLst",
];
const pGroups = [
  "lnSpc",
  "spcBef",
  "spcAft",
  "buClrTx buClr",
  "buSzTx buSzPct buSzPts",
  "buFontTx buFont",
  "buNone buAutoNum buChar buBlip",
  "tabLst",
  "defRPr",
  "extLst",
];
const bodyGroups = [
  "prstTxWarp",
  "noAutofit normAutofit spAutoFit",
  "scene3d",
  "sp3d flatTx",
  "extLst",
];
const group = (el: XmlElement, groups: string[]) =>
  el.name.namespaceURI === NS.dml
    ? groups.findIndex((g) => g.split(" ").includes(el.name.localName))
    : -1;
const defaults = (
  local: string,
  values: Record<string, string>,
  children: XmlElement[] = [],
) =>
  elem(qname("a", local, NS.dml), {
    attrs: Object.entries(values).map(([name, val]) =>
      attr(qname("", name, ""), val),
    ),
    children,
  });

export interface TextStyleCopy {
  readonly references: WeakMap<XmlAttr, PartName>;
  preserve(source: SlideShapeData, clone: XmlElement): boolean;
}

/** Per-copy caches cannot retain stale mutable source slide XML. */
export const createTextStyleCopy = (): TextStyleCopy => {
  const sharedFonts = new WeakMap<
    OpcPackage,
    ReturnType<typeof sharedFontDescriptors>
  >();
  const references = new WeakMap<XmlAttr, PartName>();
  const namespaces = new Map<
    XmlElement,
    WeakMap<XmlElement, Map<string, string>>
  >();
  const scopeFor = (root: XmlElement, el: XmlElement): Map<string, string> => {
    let scopes = namespaces.get(root);
    if (!scopes) {
      scopes = new WeakMap();
      namespaces.set(root, scopes);
      const pending = [{ el: root, scope: new Map<string, string>() }];
      while (pending.length) {
        const current = pending.pop()!;
        const scope = new Map([...current.scope, ...current.el.prefixDecls]);
        scopes.set(current.el, scope);
        for (const child of elements(current.el)) {
          // Sibling drawing properties cannot contribute a text namespace.
          // Avoid indexing large custom paths and picture clipping geometry.
          if (
            child.name.namespaceURI === NS.pml &&
            ["spPr", "grpSpPr", "blipFill"].includes(child.name.localName)
          )
            continue;
          pending.push({ el: child, scope });
        }
      }
    }
    return scopes.get(el) ?? el.prefixDecls;
  };
  const clone = (el: XmlElement, source: TextInheritanceSource): XmlElement => {
    const copy: XmlElement = {
      ...el,
      attrs: el.attrs.map((a) => {
        const next = { ...a };
        if (a.name.namespaceURI === NS.officeDocRels)
          references.set(next, references.get(a) ?? source.owner);
        return next;
      }),
      prefixDecls: new Map(scopeFor(source.root, el)),
      children: [],
    };
    copy.children = el.children.map((c) =>
      c.kind === "element" ? clone(c, source) : { ...c },
    );
    return copy;
  };
  const merge = (
    local: string,
    layers: TextInheritanceSource[],
    groups: string[],
  ): XmlElement => {
    const result = elem(qname("a", local, NS.dml));
    const attrs = new Set<string>(),
      children = new Map<string, XmlElement>();
    const runDefaults: TextInheritanceSource[] = [],
      extensions: TextInheritanceSource[] = [];
    for (const source of layers) {
      for (const a of source.element.attrs)
        if (!attrs.has(key(a))) {
          attrs.add(key(a));
          const copy = { ...a };
          result.attrs.push(copy);
          if (a.name.namespaceURI === NS.officeDocRels)
            references.set(copy, references.get(a) ?? source.owner);
        }
      // Keep declarations used only in extension attribute values too. Each
      // copied child retains its own source scope if a prefix is shadowed.
      for (const [prefix, uri] of scopeFor(source.root, source.element))
        if (!result.prefixDecls.has(prefix))
          result.prefixDecls.set(prefix, uri);
      for (const child of elements(source.element)) {
        if (
          child.name.namespaceURI === NS.dml &&
          child.name.localName === "defRPr"
        ) {
          runDefaults.push({ ...source, element: child });
          continue;
        }
        if (
          child.name.namespaceURI === NS.dml &&
          child.name.localName === "extLst"
        ) {
          extensions.push({ ...source, element: child });
          continue;
        }
        const rank = group(child, groups),
          id = rank < 0 ? key(child) : String(rank);
        if (!children.has(id)) children.set(id, clone(child, source));
      }
    }
    if (runDefaults.length)
      children.set(
        String(groups.indexOf("defRPr")),
        merge("defRPr", runDefaults, rGroups),
      );
    if (extensions.length) {
      const list = elem(qname("a", "extLst", NS.dml)),
        uris = new Set<string>();
      for (const source of extensions)
        for (const extension of elements(source.element)) {
          const id = value(extension, "uri") ?? key(extension);
          if (!uris.has(id)) {
            uris.add(id);
            list.children.push(clone(extension, source));
          }
        }
      children.set(String(groups.indexOf("extLst")), list);
    }
    result.children = [...children.values()].sort((a, b) => {
      const ai = group(a, groups),
        bi = group(b, groups);
      return (ai < 0 ? groups.length : ai) - (bi < 0 ? groups.length : bi);
    });
    return result;
  };
  const preserve = (shape: SlideShapeData, target: XmlElement): boolean => {
    const sourceBody = textBody(shape[SHAPE_ELEMENT]),
      targetBody = textBody(target);
    if (!sourceBody || !targetBody) return false;
    const bodySources = textBodySources(shape),
      own = bodySources[0]!;
    const listSources = textListStyleSources(shape),
      theme = themeForShape(shape),
      colorMap = getEffectiveColorMap(shape[SHAPE_SLIDE]);
    const autoShape = !isShapePlaceholder(shape) && !isShapeTextBox(shape);
    const bodyDefault = defaults("bodyPr", {
      anchor: autoShape ? "ctr" : "t",
      vert: "horz",
      wrap: "square",
      lIns: "91440",
      rIns: "91440",
      tIns: "45720",
      bIns: "45720",
      numCol: "1",
      spcCol: "0",
      rtlCol: "0",
      rot: "0",
      anchorCtr: "0",
      // Omitted PML body properties use compatible spacing
      // (unlike diagram text). Preserve that default across templates.
      compatLnSpc: "1",
      spcFirstLastPara: "0",
    });
    const body = merge(
      "bodyPr",
      [...bodyPropertySources(shape), { ...own, element: bodyDefault }],
      bodyGroups,
    );
    const oldBody = drawingChild(targetBody, "bodyPr");
    if (oldBody)
      targetBody.children[targetBody.children.indexOf(oldBody)] = body;
    else targetBody.children.unshift(body);

    // Typeface metadata is an OOXML font descriptor, not a bundled font. It
    // remains useful to fallback selection when the font is unavailable.
    const fontHints = new Map<string, XmlElement>();
    for (const source of bodySources) {
      const pending = [textBody(source.element)!].filter(Boolean);
      while (pending.length) {
        const current = pending.pop()!,
          family = value(current, "typeface");
        if (
          current.name.namespaceURI === NS.dml &&
          family &&
          !family.startsWith("+") &&
          ["latin", "ea", "cs", "sym", "buFont"].includes(
            current.name.localName,
          )
        ) {
          const id = family.trim().toLowerCase();
          if (!fontHints.has(id)) fontHints.set(id, current);
        }
        pending.push(...elements(current));
      }
    }
    const freeze = (root: XmlElement): void => {
      const pending = [root];
      while (pending.length) {
        const el = pending.pop()!;
        if (
          el.name.namespaceURI === NS.dml &&
          el.name.localName === "schemeClr"
        ) {
          // Resolve only the base; retain every authored color transform.
          const rgb = resolveDrawingColor(
            { ...el, children: [] },
            theme?.theme ?? null,
            colorMap,
          );
          if (rgb) {
            el.name = qname(el.name.prefix, "srgbClr", NS.dml);
            el.attrs = el.attrs.filter(
              (a) => a.name.localName !== "val" || a.name.namespaceURI !== "",
            );
            el.attrs.push(attr(qname("", "val", ""), rgb.replace(/^#/, "")));
          }
        }
        if (
          el.name.namespaceURI === NS.dml &&
          ["latin", "ea", "cs", "sym", "buFont"].includes(el.name.localName)
        ) {
          const family = resolveThemeTypeface(
            value(el, "typeface"),
            theme?.fonts,
          );
          if (family) {
            el.attrs = el.attrs.filter(
              (a) =>
                a.name.localName !== "typeface" || a.name.namespaceURI !== "",
            );
            el.attrs.push(attr(qname("", "typeface", ""), family));
            const id = family.trim().toLowerCase(),
              hint = fontHints.get(id);
            const unspecified = (name: string, field: string | null) =>
              field === null ||
              (name === "pitchFamily" && Number(field) === 0) ||
              (name === "panose" && /^0{20}$/.test(field.trim()));
            for (const name of ["panose", "pitchFamily", "charset"] as const) {
              if (!unspecified(name, value(el, name))) continue;
              let field = hint ? value(hint, name) : null;
              if (unspecified(name, field)) {
                const pkg = shape[SHAPE_SLIDE][INTERNAL_PACKAGE];
                let fonts = sharedFonts.get(pkg);
                if (!fonts) {
                  fonts = sharedFontDescriptors(pkg);
                  sharedFonts.set(pkg, fonts);
                }
                field = fonts.get(id)?.[name] ?? null;
              }
              if (field !== null) {
                el.attrs = el.attrs.filter(
                  (a) =>
                    a.name.namespaceURI !== "" || a.name.localName !== name,
                );
                el.attrs.push(attr(qname("", name, ""), field));
              }
            }
          }
        }
        pending.push(...elements(el));
      }
    };
    const title = ["title", "ctrTitle"].includes(
      getShapePlaceholderType(shape) ?? "",
    );
    const fallbackFont = title
      ? theme?.fonts?.majorLatin
      : theme?.fonts?.minorLatin;
    // Schema defaults terminate the source cascade, so a destination's bold,
    // italic, underline or bullet defaults cannot fill previously absent values.
    const fontReference = textFontReferenceDefaults(shape);
    const runFallback = defaults(
      "defRPr",
      {
        b: "0",
        i: "0",
        u: "none",
        strike: "noStrike",
        cap: "none",
        spc: "0",
        baseline: "0",
        normalizeH: "0",
        // 12pt applies when no ancestor supplies a kerning threshold.
        kern: "1200",
      },
      [
        defaults("solidFill", {}, [
          defaults("srgbClr", {
            val: (
              resolveDeckBodyTextColor(shape[SHAPE_SLIDE]) ?? "#000000"
            ).slice(1),
          }),
        ]),
        ...(fallbackFont
          ? [defaults("latin", { typeface: fallbackFont })]
          : []),
      ],
    );
    const runDefault = merge(
      "defRPr",
      [
        ...(fontReference ? [fontReference] : []),
        { ...own, element: runFallback },
      ],
      rGroups,
    );
    const paraDefault = defaults(
      "pPr",
      {
        algn: autoShape ? "ctr" : "l",
        marL: "0",
        marR: "0",
        indent: "0",
        rtl: "0",
      },
      [
        defaults("lnSpc", {}, [defaults("spcPct", { val: "100000" })]),
        defaults("spcBef", {}, [defaults("spcPts", { val: "0" })]),
        defaults("spcAft", {}, [defaults("spcPts", { val: "0" })]),
        defaults("buClrTx", {}),
        defaults("buSzTx", {}),
        defaults("buFontTx", {}),
        defaults("buNone", {}),
        defaults("tabLst", {}),
        runDefault,
      ],
    );
    const layersFor = (level: number) =>
      listSources.flatMap((source) => {
        const element = listStyleLevel(source.element, level);
        return element ? [{ ...source, element }] : [];
      });
    const list = merge("lstStyle", listSources, [
      "defPPr",
      ...Array.from({ length: 9 }, (_, i) => `lvl${i + 1}pPr`),
      "extLst",
    ]);
    const oldList = drawingChild(targetBody, "lstStyle");
    // All levels remain editable after the copy, including unused levels.
    for (let level = 0; level < 9; level++) {
      const local = `lvl${level + 1}pPr`,
        old = drawingChild(list, local),
        merged = merge(
          local,
          [...layersFor(level), { ...own, element: paraDefault }],
          pGroups,
        );
      if (old) list.children[list.children.indexOf(old)] = merged;
      else {
        const extension = drawingChild(list, "extLst"),
          index = extension
            ? list.children.indexOf(extension)
            : list.children.length;
        list.children.splice(index, 0, merged);
      }
    }
    if (oldList)
      targetBody.children[targetBody.children.indexOf(oldList)] = list;
    else targetBody.children.splice(1, 0, list);
    const sourceParagraphs = elements(sourceBody).filter(
      (el) => el.name.namespaceURI === NS.dml && el.name.localName === "p",
    );
    const targetParagraphs = elements(targetBody).filter(
      (el) => el.name.namespaceURI === NS.dml && el.name.localName === "p",
    );
    sourceParagraphs.forEach((paragraph, i) => {
      const copied = targetParagraphs[i];
      if (!copied) return;
      const pPr = drawingChild(paragraph, "pPr"),
        rawLevel = Number(pPr && value(pPr, "lvl")),
        level = Number.isFinite(rawLevel)
          ? Math.max(0, Math.min(8, rawLevel))
          : 0;
      const layers = [
        ...(pPr ? [{ ...own, element: pPr }] : []),
        ...layersFor(level),
        { ...own, element: paraDefault },
      ];
      const properties = merge("pPr", layers, pGroups),
        old = drawingChild(copied, "pPr");
      if (old) copied.children[copied.children.indexOf(old)] = properties;
      else copied.children.unshift(properties);
      const sourceItems = elements(paragraph).filter((el) =>
        ["r", "fld", "br", "endParaRPr"].includes(el.name.localName),
      );
      const copiedItems = elements(copied).filter((el) =>
        ["r", "fld", "br", "endParaRPr"].includes(el.name.localName),
      );
      const defaultRun = drawingChild(properties, "defRPr")!;
      sourceItems.forEach((item, j) => {
        const next = copiedItems[j];
        if (!next) return;
        const end = item.name.localName === "endParaRPr",
          local = end ? item : drawingChild(item, "rPr");
        const lastInline = end
          ? sourceItems
              .filter((el) => el.name.localName !== "endParaRPr")
              .at(-1)
          : null;
        const lastProperties = lastInline && drawingChild(lastInline, "rPr");
        const run = merge(
          end ? "endParaRPr" : "rPr",
          [
            ...(local ? [{ ...own, element: local }] : []),
            ...(lastProperties ? [{ ...own, element: lastProperties }] : []),
            { ...own, element: defaultRun },
          ],
          rGroups,
        );
        // The merged default already carries provenance for inherited refs.
        // clone() must transfer it rather than relabel it as slide-owned.
        if (end) copied.children[copied.children.indexOf(next)] = run;
        else {
          const old = drawingChild(next, "rPr");
          if (old) next.children[next.children.indexOf(old)] = run;
          else next.children.unshift(run);
        }
      });
    });
    freeze(targetBody);
    return true;
  };
  return { references, preserve };
};

export const preserveImportedText = (
  source: SlideData,
  root: XmlElement,
  copy: TextStyleCopy,
): boolean => {
  const targets = readShapeTreeFromCsldRoot(root, "sld").shapes;
  let changed = false;
  source[SLIDE_SHAPES].forEach((shape, i) => {
    const target = targets[i];
    if (target) changed = copy.preserve(shape, target.element) || changed;
  });
  return changed;
};
export const preserveCopiedText = (
  source: SlideShapeData,
  root: XmlElement,
  copy: TextStyleCopy,
): void => {
  copy.preserve(source, root);
  if (source[SHAPE_SNAPSHOT].kind !== "group") return;
  const targets = readGroupChildren(root);
  getGroupChildren(source).forEach((shape, i) => {
    const target = targets[i];
    if (target) preserveCopiedText(shape, target.element, copy);
  });
};

/** Import relationships inherited from another part's text styles. */
export const importTextReferences = (
  root: XmlElement,
  copy: TextStyleCopy,
  source: OpcPackage,
  sourceSlide: PartName,
  target: OpcPackage,
  rels: Relationships,
): void => {
  const rebound = new Map<string, string>(),
    graphs = new Map<string, PartName>(),
    pending = [root];
  while (pending.length) {
    const el = pending.pop()!;
    el.attrs = el.attrs.map((a) => {
      const owner = copy.references.get(a);
      if (!owner || owner === sourceSlide) return a;
      const id = `${owner}|${a.value}`;
      let newId = rebound.get(id);
      if (!newId) {
        const rel = source.getRels(owner)?.items.find((r) => r.id === a.value);
        if (!rel) return a;
        let destination = rel.target;
        if (rel.targetMode !== "External") {
          const name = resolveTarget(owner, rel.target),
            key = name.toLowerCase();
          let imported = graphs.get(key);
          if (!imported) {
            const graph = copyPartGraph(source, target, [name]);
            for (const [from, to] of graph) graphs.set(from, to);
            imported = graph.get(key)!;
          }
          destination = imported;
        }
        newId = nextRelId(rels.items.map((r) => r.id));
        rels.items.push({ ...rel, id: newId, target: destination });
        rebound.set(id, newId);
      }
      return { ...a, value: newId };
    });
    pending.push(...elements(el));
  }
};
