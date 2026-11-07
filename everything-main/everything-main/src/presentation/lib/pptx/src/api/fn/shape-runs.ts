import { readDrawingBullet } from "../../internal/drawingml/text-bullet.ts";
import { shapeRelationshipOwner } from "./shape-source.ts";
import { resolveBlipImage } from "./blip-image.ts";
// Per-run text accessors.

import { parseRPrLikeElement, resolveDrawingOpacity } from "./shape-color.ts";
import { resolveShapeColor } from "./shape-color-context.ts";
import {
  type BulletStyle,
  type ParagraphAlignment,
  type TextFormat,
  applyBulletToParagraph,
} from "../../internal/drawingml/index.ts";
import {
  emptyRels,
  nextRelId,
  partName,
  resolveTarget,
} from "../../internal/opc/index.ts";
import { REL_TYPES } from "../../internal/presentationml/index.ts";
import {
  NS,
  type XmlElement,
  attr,
  elem,
  firstChildElement,
  getAttrValue,
  insertChildByRank,
  qname,
} from "../../internal/xml/index.ts";
import {
  INTERNAL_PACKAGE,
  type PresentationData,
  SHAPE_ELEMENT,
  SHAPE_SLIDE,
  SHAPE_SNAPSHOT,
  SLIDE_PART_NAME,
  type SlideShapeData,
} from "../_internal-symbols.ts";
import { commitAndRefresh, requireTxBody } from "./_helpers.ts";
import { getSlides } from "./slide-query.ts";
import {
  findCNvPr,
  NAME_HLINK_CLICK_FN,
  type ShapeClickAction,
} from "./embedded.ts";

const NAME_TX_BODY = qname("p", "txBody", NS.pml);

// ---------------------------------------------------------------------------
// Per-run text accessors.
//
// Lets callers reach into a shape's text body to read or format a
// specific paragraph or run. `applyFormatToAllRuns` covers the bulk-edit
// case; these helpers cover "make this one word red."

const NAME_A_P = qname("a", "p", NS.dml);
const NAME_A_R = qname("a", "r", NS.dml);
export const NAME_A_RPR = qname("a", "rPr", NS.dml);
const NAME_A_T = qname("a", "t", NS.dml);

const paragraphsOf = (txBody: XmlElement): XmlElement[] =>
  txBody.children.filter(
    (c): c is XmlElement =>
      c.kind === "element" &&
      c.name.namespaceURI === NAME_A_P.namespaceURI &&
      c.name.localName === "p",
  );

export const runsOf = (paragraph: XmlElement): XmlElement[] =>
  paragraph.children.filter(
    (c): c is XmlElement =>
      c.kind === "element" &&
      c.name.namespaceURI === NAME_A_R.namespaceURI &&
      c.name.localName === "r",
  );

export const requireParagraph = (
  shape: SlideShapeData,
  paragraphIndex: number,
): XmlElement => {
  const txBody = requireTxBody(shape);
  const paragraphs = paragraphsOf(txBody);
  const paragraph = paragraphs[paragraphIndex];
  if (!paragraph) {
    throw new RangeError(
      `paragraph index ${paragraphIndex} out of range (have ${paragraphs.length})`,
    );
  }
  return paragraph;
};

export const requireRun = (
  shape: SlideShapeData,
  paragraphIndex: number,
  runIndex: number,
): XmlElement => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const runs = runsOf(paragraph);
  const run = runs[runIndex];
  if (!run) {
    throw new RangeError(
      `run index ${runIndex} out of range in paragraph ${paragraphIndex} (have ${runs.length})`,
    );
  }
  return run;
};

export const ensureRPr = (run: XmlElement): XmlElement => {
  const existing = firstChildElement(run, NAME_A_RPR);
  if (existing !== null) return existing;
  // `<a:rPr>` is the first child of `<a:r>` per the schema.
  const fresh = elem(NAME_A_RPR);
  run.children.unshift(fresh);
  return fresh;
};

const readRunText = (run: XmlElement): string => {
  const tEl = firstChildElement(run, NAME_A_T);
  if (tEl === null) return "";
  let out = "";
  for (const child of tEl.children) {
    if (child.kind === "text" || child.kind === "cdata") out += child.data;
  }
  return out;
};

const writeRunText = (run: XmlElement, value: string): void => {
  let tEl = firstChildElement(run, NAME_A_T);
  if (tEl === null) {
    tEl = elem(NAME_A_T);
    run.children.push(tEl);
  }
  tEl.children = [{ kind: "text", data: value }];
};

/** Number of paragraphs in the shape's text body. Throws for non-text shapes. */
export const getShapeParagraphCount = (shape: SlideShapeData): number =>
  paragraphsOf(requireTxBody(shape)).length;

/**
 * One inline element in a paragraph as ordered: a literal text run
 * (`<a:r>`), a field substitution (`<a:fld>` — slide number, date, etc.),
 * or a line break (`<a:br>`). Renderers walk this list instead of the
 * strict `<a:r>`-only `getShapeRunCount` / `getShapeRunText` pair when
 * they need to reproduce the paragraph's full visible content.
 *
 * `text` is the cached value (`<a:t>` content for `r` and `fld`; `''`
 * for `br`). `format` is the literal `<a:rPr>` on the element when
 * present; use `getShapeRunFormatEffective` to walk inheritance.
 *
 * Field kinds (`fld.type`): typical ECMA-376 `ST_TextFieldType` tokens
 * are `slidenum`, `datetime` (variants `1`..`13`), `presentationDate`,
 * `headerfooter`, `footer`, etc. Unrecognised tokens come through
 * unchanged so renderers can decide whether to substitute live values.
 */
export type ShapeParagraphElement =
  | {
      readonly kind: "r";
      readonly text: string;
      readonly format: TextFormat | null;
    }
  | {
      readonly kind: "fld";
      readonly text: string;
      readonly format: TextFormat | null;
      readonly type: string | null;
    }
  | { readonly kind: "br"; readonly format: TextFormat | null };

/**
 * Returns the inline children of a paragraph in document order — runs,
 * field placeholders, and line breaks. Used by renderers that need to
 * reproduce the paragraph faithfully (the `<a:r>`-only run accessors
 * silently drop fields and breaks).
 */
export const getShapeParagraphElements = (
  shape: SlideShapeData,
  paragraphIndex: number,
): ReadonlyArray<ShapeParagraphElement> =>
  readParagraphElements(requireParagraph(shape, paragraphIndex));

/**
 * Walks a single `<a:p>` element and returns its inline children in
 * document order. Shared by the shape-text reader above and the table-cell
 * text reader: both use the identical DrawingML run/field/break grammar, so
 * only the way the paragraph element is located differs.
 *
 * @internal
 */
export const readParagraphElements = (
  paragraph: XmlElement,
  readFormat?: (properties: XmlElement | null) => TextFormat | null,
): ReadonlyArray<ShapeParagraphElement> => {
  const out: ShapeParagraphElement[] = [];
  const readT = (parent: XmlElement): string => {
    const tEl = firstChildElement(parent, NAME_A_T);
    if (!tEl) return "";
    let acc = "";
    for (const c of tEl.children) {
      if (c.kind === "text" || c.kind === "cdata") acc += c.data;
    }
    return acc;
  };
  const readFmt = (parent: XmlElement): TextFormat | null => {
    const rPr = firstChildElement(parent, NAME_A_RPR);
    if (readFormat) return readFormat(rPr);
    if (!rPr) return null;
    return parseRPrLikeElement(rPr) as TextFormat;
  };
  for (const child of paragraph.children) {
    if (child.kind !== "element" || child.name.namespaceURI !== NS.dml)
      continue;
    if (child.name.localName === "r") {
      out.push({ kind: "r", text: readT(child), format: readFmt(child) });
    } else if (child.name.localName === "fld") {
      const type = getAttrValue(child, qname("", "type", ""));
      out.push({
        kind: "fld",
        text: readT(child),
        format: readFmt(child),
        type,
      });
    } else if (child.name.localName === "br") {
      out.push({ kind: "br", format: readFmt(child) });
    }
  }
  return out;
};

/**
 * Number of text runs in the given paragraph. Throws on out-of-range
 * paragraph index or non-text shapes.
 */
export const getShapeRunCount = (
  shape: SlideShapeData,
  paragraphIndex: number,
): number => runsOf(requireParagraph(shape, paragraphIndex)).length;

/** Visible text of a single run. */
export const getShapeRunText = (
  shape: SlideShapeData,
  paragraphIndex: number,
  runIndex: number,
): string => readRunText(requireRun(shape, paragraphIndex, runIndex));

/**
 * Sets `<a:hlinkClick>` on a single run. Per-run counterpart to
 * `setShapeHyperlink` (which targets every run in the shape). Pass
 * `null` to clear the link on that run alone — other runs are
 * untouched. Allocates or reuses a hyperlink rel on the slide
 * exactly like the shape-level setter.
 */
export const setShapeRunHyperlink = (
  shape: SlideShapeData,
  paragraphIndex: number,
  runIndex: number,
  url: string | null,
  tooltip?: string,
): void => {
  const run = requireRun(shape, paragraphIndex, runIndex);
  let rPr = firstChildElement(run, qname("a", "rPr", NS.dml));
  if (rPr === null) {
    rPr = elem(qname("a", "rPr", NS.dml));
    run.children.unshift(rPr);
  }
  rPr.children = rPr.children.filter(
    (c) =>
      !(
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        c.name.localName === "hlinkClick"
      ),
  );
  if (url !== null) {
    const slide = shape[SHAPE_SLIDE];
    const pkg = slide[INTERNAL_PACKAGE];
    const rels = pkg.getRels(slide[SLIDE_PART_NAME]) ?? emptyRels();
    const existing = rels.items.find(
      (r) =>
        r.type === REL_TYPES.hyperlink &&
        r.target === url &&
        r.targetMode === "External",
    );
    let rId: string;
    if (existing) {
      rId = existing.id;
    } else {
      rId = nextRelId(rels.items.map((r) => r.id));
      rels.items.push({
        id: rId,
        type: REL_TYPES.hyperlink,
        target: url,
        targetMode: "External",
      });
      pkg.setRels(slide[SLIDE_PART_NAME], rels);
    }
    const hlinkAttrs = [attr(qname("r", "id", NS.officeDocRels), rId)];
    if (tooltip !== undefined) {
      hlinkAttrs.push(attr(qname("", "tooltip", ""), tooltip));
    }
    rPr.children.push(
      elem(qname("a", "hlinkClick", NS.dml), {
        attrs: hlinkAttrs,
      }),
    );
  }
  commitAndRefresh(shape);
};

/**
 * Reads the external URL on a single run's `<a:hlinkClick>`. Per-run
 * counterpart to `getShapeHyperlink` (which only surfaces the first
 * link it finds). Returns `null` when this run has no link, or the
 * link's `r:id` resolves to a non-hyperlink rel.
 */
export const getShapeRunHyperlink = (
  shape: SlideShapeData,
  paragraphIndex: number,
  runIndex: number,
): string | null => {
  const run = requireRun(shape, paragraphIndex, runIndex);
  const rPr = firstChildElement(run, qname("a", "rPr", NS.dml));
  if (!rPr) return null;
  const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
  if (!hlink) return null;
  const rId = getAttrValue(hlink, qname("r", "id", NS.officeDocRels));
  if (!rId) return null;
  const slide = shape[SHAPE_SLIDE];
  const rels = slide[INTERNAL_PACKAGE].getRels(
    shapeRelationshipOwner(shape, hlink),
  );
  if (!rels) return null;
  const rel = rels.items.find((x) => x.id === rId);
  if (rel?.type === REL_TYPES.hyperlink && rel.targetMode === "External")
    return rel.target;
  return null;
};

/**
 * Reads the tooltip text on the shape's `<a:hlinkClick tooltip="…"/>`.
 * Returns `null` when no hyperlink is set or the link doesn't author
 * a tooltip. Tooltips show up when the user hovers over
 * a linked shape in slide-show mode.
 *
 * Scans run-level `<a:rPr><a:hlinkClick>` first (where
 * `setShapeHyperlink` writes) and falls back to the
 * `<p:nvSpPr><p:cNvPr><a:hlinkClick>` shape-click hyperlink. Mirrors
 * `getShapeHyperlink`'s read path so the writer / reader pair is
 * consistent.
 */
export const getShapeHyperlinkTooltip = (
  shape: SlideShapeData,
): string | null => {
  if (shape[SHAPE_SNAPSHOT].kind === "shape") {
    const txBody = firstChildElement(shape[SHAPE_ELEMENT], NAME_TX_BODY);
    if (txBody) {
      for (const p of txBody.children) {
        if (
          p.kind !== "element" ||
          p.name.namespaceURI !== NS.dml ||
          p.name.localName !== "p"
        )
          continue;
        for (const r of p.children) {
          if (
            r.kind !== "element" ||
            r.name.namespaceURI !== NS.dml ||
            r.name.localName !== "r"
          )
            continue;
          const rPr = firstChildElement(r, qname("a", "rPr", NS.dml));
          if (!rPr) continue;
          const hlink = firstChildElement(
            rPr,
            qname("a", "hlinkClick", NS.dml),
          );
          if (!hlink) continue;
          const tt = getAttrValue(hlink, qname("", "tooltip", ""));
          if (tt !== null) return tt;
        }
      }
    }
  }
  const cNvPr = findCNvPr(shape);
  if (!cNvPr) return null;
  const hlink = firstChildElement(cNvPr, NAME_HLINK_CLICK_FN);
  if (!hlink) return null;
  const tt = getAttrValue(hlink, qname("", "tooltip", ""));
  return tt ?? null;
};

/**
 * Reads the tooltip on a per-run `<a:rPr><a:hlinkClick tooltip="…"/>`.
 * Same semantics as `getShapeHyperlinkTooltip` but scoped to a single
 * run.
 */
export const getShapeRunHyperlinkTooltip = (
  shape: SlideShapeData,
  paragraphIndex: number,
  runIndex: number,
): string | null => {
  const run = requireRun(shape, paragraphIndex, runIndex);
  const rPr = firstChildElement(run, qname("a", "rPr", NS.dml));
  if (!rPr) return null;
  const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
  if (!hlink) return null;
  const tt = getAttrValue(hlink, qname("", "tooltip", ""));
  return tt ?? null;
};

/**
 * Same as `getShapeClickAction` but reads the per-run
 * `<a:rPr><a:hlinkClick action=… r:id=…/>`. Recognises:
 *
 *   - `{ kind: 'url', url }` — external hyperlink rel
 *   - `{ kind: 'slide', slide }` — slide-jump action + slide rel
 *   - `{ kind: 'nextSlide' | 'prevSlide' | 'firstSlide' | 'lastSlide' }`
 *
 * Returns `null` for runs without an action or unknown action tokens.
 */
export const getShapeRunClickAction = (
  shape: SlideShapeData,
  paragraphIndex: number,
  runIndex: number,
): ShapeClickAction | null => {
  const run = requireRun(shape, paragraphIndex, runIndex);
  const rPr = firstChildElement(run, qname("a", "rPr", NS.dml));
  if (!rPr) return null;
  const hlink = firstChildElement(rPr, qname("a", "hlinkClick", NS.dml));
  if (!hlink) return null;
  const action = getAttrValue(hlink, qname("", "action", ""));
  const rId = getAttrValue(hlink, qname("r", "id", NS.officeDocRels));

  if (action === "ppaction://hlinkshowjump?jump=nextslide")
    return { kind: "nextSlide" };
  if (action === "ppaction://hlinkshowjump?jump=previousslide")
    return { kind: "prevSlide" };
  if (action === "ppaction://hlinkshowjump?jump=firstslide")
    return { kind: "firstSlide" };
  if (action === "ppaction://hlinkshowjump?jump=lastslide")
    return { kind: "lastSlide" };

  if (rId === null || rId === "") return null;
  const slide = shape[SHAPE_SLIDE];
  const pkg = slide[INTERNAL_PACKAGE];
  const owner = shapeRelationshipOwner(shape, hlink);
  const rels = pkg.getRels(owner);
  if (!rels) return null;
  const rel = rels.items.find((r) => r.id === rId);
  if (!rel) return null;
  if (action === "ppaction://hlinksldjump" && rel.type === REL_TYPES.slide) {
    const targetPartName = rel.target.startsWith("/")
      ? partName(rel.target)
      : resolveTarget(owner, rel.target);
    const pres: PresentationData = {
      [INTERNAL_PACKAGE]: pkg,
      _slidesCache: null,
    };
    for (const candidate of getSlides(pres)) {
      if (candidate[SLIDE_PART_NAME] === targetPartName)
        return { kind: "slide", slide: candidate };
    }
    return null;
  }
  if (rel.type === REL_TYPES.hyperlink && rel.targetMode === "External") {
    return { kind: "url", url: rel.target };
  }
  return null;
};

export const NAME_A_PPR = qname("a", "pPr", NS.dml);
export const ATTR_LVL = qname("", "lvl", "");
const ATTR_ALGN_FN = qname("", "algn", "");

const ensurePPr = (paragraph: XmlElement): XmlElement => {
  const existing = firstChildElement(paragraph, NAME_A_PPR);
  if (existing !== null) return existing;
  const fresh = elem(NAME_A_PPR);
  // <a:pPr> must be the first child of <a:p>.
  paragraph.children.unshift(fresh);
  return fresh;
};

const alignTokenForFn = (a: ParagraphAlignment): string => {
  switch (a) {
    case "left":
    case "l":
      return "l";
    case "center":
    case "ctr":
      return "ctr";
    case "right":
    case "r":
      return "r";
    case "justify":
    case "just":
      return "just";
    case "distribute":
    case "dist":
      return "dist";
    default:
      return a;
  }
};

/**
 * Sets the horizontal alignment of a single paragraph. Same token set
 * as `setShapeAlignment`. Other paragraphs are untouched.
 */
export const setParagraphAlignment = (
  shape: SlideShapeData,
  paragraphIndex: number,
  align: ParagraphAlignment,
): void => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = ensurePPr(paragraph);
  pPr.attrs = pPr.attrs.filter((a) => a.name.localName !== "algn");
  pPr.attrs.push(attr(ATTR_ALGN_FN, alignTokenForFn(align)));
  commitAndRefresh(shape);
};

/**
 * Sets the paragraph's nesting level (`<a:pPr lvl="N"/>`). Levels are
 * 0-indexed; ST_TextIndentLevelType allows 0 through 8. Pass `0` to clear an
 * existing level — `<a:pPr lvl="0"/>` is the same as omitting the attr.
 *
 * Used in tandem with bullets to author nested lists:
 *
 *   setShapeText(shape, 'Item 1\nNested\nItem 2');
 *   setShapeBullets(shape, 'bullet');
 *   setParagraphLevel(shape, 1, 1);  // indent the second line
 */
export const setParagraphLevel = (
  shape: SlideShapeData,
  paragraphIndex: number,
  level: number,
): void => {
  if (!Number.isInteger(level) || level < 0 || level > 8) {
    throw new RangeError(
      `paragraph level must be an integer in [0, 8], got ${level}`,
    );
  }
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = ensurePPr(paragraph);
  pPr.attrs = pPr.attrs.filter((a) => a.name.localName !== "lvl");
  if (level > 0) pPr.attrs.push(attr(ATTR_LVL, String(level)));
  commitAndRefresh(shape);
};

/**
 * Reads the paragraph's horizontal alignment. Returns `null` when no
 * `algn` attribute is present (inherits from layout / master).
 */
export const getParagraphAlignment = (
  shape: SlideShapeData,
  paragraphIndex: number,
): ParagraphAlignment | null => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  if (pPr === null) return null;
  const v = getAttrValue(pPr, ATTR_ALGN_FN);
  return (v as ParagraphAlignment | null) ?? null;
};

/**
 * Reads the paragraph's nesting level (`lvl` attribute), or `0` when
 * absent — the spec default. Returns `null` for non-existent
 * paragraphs.
 */
export const getParagraphLevel = (
  shape: SlideShapeData,
  paragraphIndex: number,
): number => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  if (pPr === null) return 0;
  const v = getAttrValue(pPr, ATTR_LVL);
  if (v === null) return 0;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

// CT_TextParagraphProperties (a:pPr) is an xsd:sequence: line spacing, then
// before/after spacing, then the bullet-related groups, then tabLst/defRPr.
// Setters strip their element then re-insert at the mandated slot.
const PPR_CHILD_RANK: Record<string, number> = {
  lnSpc: 0,
  spcBef: 1,
  spcAft: 2,
  buClrTx: 3,
  buClr: 3,
  buSzTx: 4,
  buSzPct: 4,
  buSzPts: 4,
  buFontTx: 5,
  buFont: 5,
  buNone: 6,
  buAutoNum: 6,
  buChar: 6,
  tabLst: 7,
  defRPr: 8,
  extLst: 9,
};
const pPrChildRank = (el: XmlElement): number =>
  el.name.namespaceURI === NS.dml
    ? (PPR_CHILD_RANK[el.name.localName] ?? 99)
    : 99;

/**
 * Sets the spacing before and/or after a paragraph, in points (where
 * a "point" is 1/72 inch). The XML stores these as hundredths of a
 * point inside `<a:pPr><a:spcBef>/<a:spcAft><a:spcPts val="…"/>` —
 * the helper converts.
 *
 *   setParagraphSpacing(shape, 0, { beforePts: 6, afterPts: 3 });
 *
 * Use beforePct/afterPct for multiples of the boundary line's natural height.
 * Supply only one unit for each side. Omitting a side keeps its existing value.
 * Passing a side as `null` removes that spacing element.
 */
export const setParagraphSpacing = (
  shape: SlideShapeData,
  paragraphIndex: number,
  opts: {
    beforePts?: number | null;
    afterPts?: number | null;
    /** A multiple of the first line's natural height (1 = 100%). */
    beforePct?: number | null;
    /** A multiple of the last line's natural height (1 = 100%). */
    afterPct?: number | null;
  },
): void => {
  // Validate the entire update before changing either side.
  for (const side of ["before", "after"] as const) {
    if (opts[`${side}Pts`] !== undefined && opts[`${side}Pct`] !== undefined)
      throw new RangeError(`paragraph ${side} spacing must use one unit`);
    const value = opts[`${side}Pts`] ?? opts[`${side}Pct`];
    if (value != null && (!Number.isFinite(value) || value < 0))
      throw new RangeError(`paragraph ${side} spacing must be non-negative`);
  }
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = ensurePPr(paragraph);

  const writeSide = (
    localName: "spcBef" | "spcAft",
    value: number | null | undefined,
    percent: boolean,
  ): void => {
    if (value === undefined) return;
    pPr.children = pPr.children.filter(
      (c) =>
        !(
          c.kind === "element" &&
          c.name.namespaceURI === NS.dml &&
          c.name.localName === localName
        ),
    );
    if (value === null) return;
    const spcEl = elem(qname("a", localName, NS.dml), {
      children: [
        elem(qname("a", percent ? "spcPct" : "spcPts", NS.dml), {
          attrs: [
            attr(
              qname("", "val", ""),
              String(Math.round(value * (percent ? 100000 : 100))),
            ),
          ],
        }),
      ],
    });
    // spcBef/spcAft must precede any bullet (buChar/buAutoNum/buFont/...) and
    // tabLst/defRPr in CT_TextParagraphProperties; insert at the schema slot
    // rather than pushing to the end of a paragraph that already has bullets.
    insertChildByRank(pPr, spcEl, pPrChildRank);
  };

  writeSide(
    "spcBef",
    opts.beforePct !== undefined ? opts.beforePct : opts.beforePts,
    opts.beforePct !== undefined,
  );
  writeSide(
    "spcAft",
    opts.afterPct !== undefined ? opts.afterPct : opts.afterPts,
    opts.afterPct !== undefined,
  );
  commitAndRefresh(shape);
};

/**
 * Literal paragraph spacing. Point-valued sides use beforePts/afterPts;
 * percentage-valued sides additionally expose beforePct/afterPct as multiples
 * (1 = 100%) and have a null point value. An absent side inherits its value.
 */
export const getParagraphSpacing = (
  shape: SlideShapeData,
  paragraphIndex: number,
): {
  readonly beforePts: number | null;
  readonly afterPts: number | null;
  readonly beforePct?: number;
  readonly afterPct?: number;
} => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  const before = readTextSpacing(pPr, "spcBef");
  const after = readTextSpacing(pPr, "spcAft");
  return {
    beforePts: before?.kind === "pts" ? before.value : null,
    afterPts: after?.kind === "pts" ? after.value : null,
    ...(before?.kind === "pct" ? { beforePct: before.value } : {}),
    ...(after?.kind === "pct" ? { afterPct: after.value } : {}),
  };
};

/** Read DrawingML's point/percentage spacing choice without losing its unit. */
export const readTextSpacing = (
  pPr: XmlElement | null,
  localName: "spcBef" | "spcAft" | "lnSpc",
):
  | { readonly kind: "pct"; readonly value: number }
  | { readonly kind: "pts"; readonly value: number }
  | null => {
  const side = pPr && firstChildElement(pPr, qname("a", localName, NS.dml));
  if (!side) return null;
  for (const [name, kind, denominator] of [
    ["spcPct", "pct", 100000],
    ["spcPts", "pts", 100],
  ] as const) {
    const child = firstChildElement(side, qname("a", name, NS.dml));
    const raw = child && getAttrValue(child, qname("", "val", ""));
    if (!raw?.trim()) continue;
    const percentString = kind === "pct" && raw.trim().endsWith("%");
    const number = percentString ? raw.trim().slice(0, -1).trim() : raw.trim();
    if (!number) continue;
    const value = Number(number) / (percentString ? 100 : denominator);
    if (Number.isFinite(value) && value >= 0) return { kind, value };
  }
  return null;
};

/**
 * Reads the paragraph's left / right / first-line indents from
 * `<a:pPr marL="…" marR="…" indent="…"/>`. Each is in EMU (matching
 * the XML storage); positive means a positive indent,
 * negative `indent` is a hanging indent (typical for bullets).
 *
 * Returns `null` for sides the paragraph doesn't set (those inherit
 * from the layout / master).
 */
export const getParagraphIndent = (
  shape: SlideShapeData,
  paragraphIndex: number,
): {
  leftEmu: number | null;
  rightEmu: number | null;
  firstLineEmu: number | null;
} => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  if (!pPr) return { leftEmu: null, rightEmu: null, firstLineEmu: null };
  const read = (name: string): number | null => {
    const raw = getAttrValue(pPr, qname("", name, ""));
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    leftEmu: read("marL"),
    rightEmu: read("marR"),
    firstLineEmu: read("indent"),
  };
};

/**
 * Reads the paragraph's `<a:lnSpc>` line spacing. The XML stores
 * line spacing two ways:
 *
 *   - Multiple of the natural line height — `<a:spcPct val="150000"/>`
 *     (= 1.5×). Returns `{ kind: 'pct', value }` with value as the unit
 *     fraction (1.5).
 *   - Fixed points — `<a:spcPts val="2400"/>` (= 24pt). Returns
 *     `{ kind: 'pts', value }` with value in points.
 *
 * Returns `null` when no `<a:lnSpc>` is present (the paragraph
 * inherits line spacing from the layout / master).
 */
export const getParagraphLineSpacing = (
  shape: SlideShapeData,
  paragraphIndex: number,
):
  | { readonly kind: "pct"; readonly value: number }
  | { readonly kind: "pts"; readonly value: number }
  | null => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  return readTextSpacing(firstChildElement(paragraph, NAME_A_PPR), "lnSpc");
};

/**
 * Sets a paragraph's line spacing — the writer counterpart to
 * `getParagraphLineSpacing`. Two modes (mirroring `<a:lnSpc>`):
 *
 *   - `{ kind: 'pct', value }` — a multiple of single spacing
 *     (`1` = single, `1.5` = 150%, `2` = double) → `<a:spcPct>`.
 *   - `{ kind: 'pts', value }` — a fixed leading in points → `<a:spcPts>`.
 *
 * Pass `null` to clear the override (the paragraph then inherits line
 * spacing from the layout / master).
 */
export const setParagraphLineSpacing = (
  shape: SlideShapeData,
  paragraphIndex: number,
  spacing:
    | { readonly kind: "pct"; readonly value: number }
    | { readonly kind: "pts"; readonly value: number }
    | null,
): void => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = ensurePPr(paragraph);
  pPr.children = pPr.children.filter(
    (c) =>
      !(
        c.kind === "element" &&
        c.name.namespaceURI === NS.dml &&
        c.name.localName === "lnSpc"
      ),
  );
  if (spacing !== null) {
    if (!Number.isFinite(spacing.value) || spacing.value < 0) {
      throw new RangeError(
        `line spacing value must be a non-negative number, got ${spacing.value}`,
      );
    }
    const inner =
      spacing.kind === "pct"
        ? elem(qname("a", "spcPct", NS.dml), {
            attrs: [
              attr(
                qname("", "val", ""),
                String(Math.round(spacing.value * 100000)),
              ),
            ],
          })
        : elem(qname("a", "spcPts", NS.dml), {
            attrs: [
              attr(
                qname("", "val", ""),
                String(Math.round(spacing.value * 100)),
              ),
            ],
          });
    // <a:lnSpc> is the first child of CT_TextParagraphProperties.
    insertChildByRank(
      pPr,
      elem(qname("a", "lnSpc", NS.dml), { children: [inner] }),
      pPrChildRank,
    );
  }
  commitAndRefresh(shape);
};

/**
 * Reads back the bullet style on a single paragraph, or `null` when
 * no `<a:buChar>` / `<a:buAutoNum>` / `<a:buNone>` is present (the
 * paragraph inherits its bullet from the layout / master).
 */
export const getParagraphBullet = (
  shape: SlideShapeData,
  paragraphIndex: number,
): BulletStyle | null => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  if (pPr === null) return null;
  for (const c of pPr.children) {
    if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
    const bullet = readDrawingBullet(c);
    if (bullet !== null) return bullet;
  }
  return null;
};

/**
 * Returns `true` when the paragraph uses an image as its bullet
 * (`<a:pPr><a:buBlip r:embed="…"/>`). Renderers without image
 * support should fall back to a generic bullet glyph.
 *
 * The underlying rId / image bytes aren't surfaced here — resolving
 * that would need the rels of the layout / master the paragraph
 * inherits from, which can be cumbersome. Knowing that the bullet
 * *is* an image is usually enough for the UI to pick a fallback.
 */
export const isParagraphBulletPicture = (
  shape: SlideShapeData,
  paragraphIndex: number,
): boolean => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  if (!pPr) return false;
  return firstChildElement(pPr, qname("a", "buBlip", NS.dml)) !== null;
};

/**
 * Returns the embedded image bytes backing a paragraph's picture bullet
 * (`<a:pPr><a:buBlip><a:blip r:embed="…"/>`), or `null` when the
 * paragraph has no picture bullet or the relationship can't be resolved
 * (external `r:link`, missing media part, etc.).
 *
 * The preferred SVG or raster reference resolves against its owning
 * slide/layout/master relationships, matching `getShapeImageBytes`.
 * The returned `Uint8Array` is a live view into the package media part;
 * treat it as read-only.
 */
export const getParagraphBulletImageBytes = (
  shape: SlideShapeData,
  paragraphIndex: number,
): Uint8Array | null => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  if (!pPr) return null;
  const buBlip = firstChildElement(pPr, qname("a", "buBlip", NS.dml));
  if (!buBlip) return null;
  const blip = firstChildElement(buBlip, qname("a", "blip", NS.dml));
  if (!blip) return null;
  const slide = shape[SHAPE_SLIDE];
  const pkg = slide[INTERNAL_PACKAGE];
  const owner = shapeRelationshipOwner(shape, blip);
  return resolveBlipImage(pkg, owner, blip)?.part.data ?? null;
};

/**
 * Reads the bullet's per-paragraph color, size, and font overrides —
 * `<a:buClr>` (theme-resolved hex), `<a:buSzPct>` / `<a:buSzPts>`
 * (size relative to run or fixed pt), and `<a:buFont typeface="…"/>`.
 *
 * Returns `{ color: null, sizePct: null, sizePts: null, font: null }`
 * when the paragraph doesn't override any of them (the bullet inherits
 * from the run / layout).
 */
export const getParagraphBulletStyle = (
  pres: PresentationData,
  shape: SlideShapeData,
  paragraphIndex: number,
  colorMap?: Readonly<Record<string, string>> | null,
): {
  color: string | null;
  colorOpacity?: number;
  sizePct: number | null;
  sizePts: number | null;
  font: string | null;
} => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  const pPr = firstChildElement(paragraph, NAME_A_PPR);
  return readParagraphBulletStyle(pres, shape, pPr, colorMap);
};

/** @internal Shared literal reader for one paragraph-property layer. */
export const readParagraphBulletStyle = (
  pres: PresentationData,
  shape: SlideShapeData,
  pPr: XmlElement | null,
  colorMap?: Readonly<Record<string, string>> | null,
): ReturnType<typeof getParagraphBulletStyle> => {
  if (!pPr) return { color: null, sizePct: null, sizePts: null, font: null };
  let color: string | null = null;
  let colorOpacity: number | undefined;
  let sizePct: number | null = null;
  let sizePts: number | null = null;
  let font: string | null = null;
  const buClr = firstChildElement(pPr, qname("a", "buClr", NS.dml));
  if (buClr) {
    for (const c of buClr.children) {
      if (c.kind !== "element" || c.name.namespaceURI !== NS.dml) continue;
      color = resolveShapeColor(pres, shape, c, colorMap);
      if (color !== null) colorOpacity = resolveDrawingOpacity(c);
      break;
    }
  }
  const buSzPct = firstChildElement(pPr, qname("a", "buSzPct", NS.dml));
  if (buSzPct) {
    const v = getAttrValue(buSzPct, qname("", "val", ""));
    if (v !== null) {
      let n = Number.parseFloat(v);
      if (Number.isFinite(n)) {
        if (Math.abs(n) > 1) n = n / 100000;
        sizePct = n;
      }
    }
  }
  const buSzPts = firstChildElement(pPr, qname("a", "buSzPts", NS.dml));
  if (buSzPts) {
    const v = getAttrValue(buSzPts, qname("", "val", ""));
    if (v !== null) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) sizePts = n / 100;
    }
  }
  const buFont = firstChildElement(pPr, qname("a", "buFont", NS.dml));
  if (buFont) {
    const t = getAttrValue(buFont, qname("", "typeface", ""));
    if (t !== null) font = t;
  }
  return {
    color,
    ...(colorOpacity !== undefined ? { colorOpacity } : {}),
    sizePct,
    sizePts,
    font,
  };
};

/**
 * Sets the bullet style on a single paragraph. Same `BulletStyle` shape
 * as `setShapeBullets` — pass `'bullet'` / `'number'` / `'none'` or an
 * object like `{ char: '◆' }` / `{ autoNum: 'romanLcPeriod' }`.
 */
export const setParagraphBullet = (
  shape: SlideShapeData,
  paragraphIndex: number,
  style: BulletStyle,
): void => {
  const paragraph = requireParagraph(shape, paragraphIndex);
  applyBulletToParagraph(paragraph, style);
  commitAndRefresh(shape);
};

/**
 * Sets the text of a single run. Existing rPr (font, size, color, ...)
 * is preserved — only the visible characters change.
 */
export const setShapeRunText = (
  shape: SlideShapeData,
  paragraphIndex: number,
  runIndex: number,
  text: string,
): void => {
  const run = requireRun(shape, paragraphIndex, runIndex);
  writeRunText(run, text);
  commitAndRefresh(shape);
};
