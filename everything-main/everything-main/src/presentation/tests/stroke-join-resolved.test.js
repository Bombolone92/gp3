import { describe, expect, it } from "vitest";
import { P, parseDeck } from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import {
  NS,
  parseXml,
  walkElements,
  getAttrValue,
  qname,
} from "../lib/pptx/src/internal/xml/index.ts";
import { strokeJoinFixture } from "./stroke-join-fixture.js";
const attr = (el, name) => getAttrValue(el, qname("", name, ""));
function outlines(p, s) {
  const result = [];
  walkElements(
    parseXml(renderSlideToSvg(p, s, { textLayout: "svg" })).root,
    (el) => {
      if (attr(el, "stroke") === "#1267B2")
        result.push({
          join: attr(el, "stroke-linejoin"),
          limit: attr(el, "stroke-miterlimit"),
        });
    },
  );
  return result;
}
describe("native outline joins", () => {
  it.each(
    Array.from({ length: 8 }, (_, i) => [
      i,
      i % 4 === 2 ? "miter" : i % 4 === 3 ? "bevel" : "round",
    ]),
  )("matches native control %i with %s joins", async (index, join) => {
    const p = await parseDeck(await strokeJoinFixture()),
      s = P.getSlides(p)[0],
      style = outlines(p, s)[index];
    expect(style.join).toBe(join);
    expect(style.limit).toBe(join === "miter" ? "8" : null);
  });
});

import { createDeck } from "../src/model.js";
import { unzipSync, strFromU8, strToU8 } from "fflate";
import native from "./data/stroke-join-native.json" with { type: "json" };
import { strokeJoinEdgeFixture } from "./stroke-join-fixture.js";
import {
  lineFormattingFixture,
  lineProperties,
  lineStyleRef,
} from "./line-formatting-fixture.js";
import {
  createGeometryDeck,
  presetGeometry,
  triangleGeometry,
} from "./geometry-fixture.js";

describe("resolved joins preserve native inheritance and authored semantics", () => {
  it.each(
    native.presetExceptions.flatMap((preset) =>
      ["omitted", "round", "miter", "bevel"].map((join) => [preset, join]),
    ),
  )(
    "matches native %s / %s policy without rewriting XML",
    async (preset, join) => {
      const p = createDeck("blank"),
        s = P.getSlides(p)[0],
        sh = P.addSlideShape(s, {
          preset,
          x: P.inches(0.73),
          y: P.inches(0.41),
          w: P.inches(4.8),
          h: P.inches(0.5),
        });
      P.setShapeNoFill(sh);
      P.setShapeStroke(sh, { color: "#1267B2", widthEmu: P.pt(3) });
      if (join !== "omitted") P.setShapeStrokeJoin(sh, join);
      const before = unzipSync(await P.savePresentation(p));
      expect(P.getShapeStrokeJoin(sh)).toBe(join === "omitted" ? null : join);
      expect(P.getShapeStrokeFormattingEffective(sh).join?.kind ?? null).toBe(
        join === "omitted" ? null : join,
      );
      const expected =
        join === "bevel" ? { kind: "bevel" } : { kind: "miter", limit: 8 };
      expect(P.getShapeStrokeJoinResolved(sh)).toEqual(expected);
      expect(outlines(p, s)[0]).toEqual({
        join: expected.kind,
        limit: expected.kind === "miter" ? "8" : null,
      });
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it.each(Array.from({ length: 12 }, (_, i) => [i]))(
    "matches native picture/custom-path/star edge control %i",
    async (index) => {
      const p = await parseDeck(await strokeJoinEdgeFixture()),
        s = P.getSlides(p)[0],
        sh = P.getSlideShapes(s)[index];
      const row = Math.floor(index / 4),
        col = index % 4;
      const join = (
        row === 2
          ? native.edgeControls.star5Joins
          : row === 1
            ? native.edgeControls.customPathJoins
            : native.edgeControls.pictureJoins
      )[col];
      const limit = join === "miter" ? (col === 2 ? 3.5 : 8) : undefined;
      expect(P.getShapeStrokeJoinResolved(sh)).toEqual({
        kind: join,
        ...(limit === undefined ? {} : { limit }),
      });
      expect(outlines(p, s)[index]).toEqual({
        join,
        limit: limit === undefined ? null : String(limit),
      });
    },
  );
  it.each(["layout", "master"])(
    "uses a %s preset with an independently inherited round join",
    async (level) => {
      const bytes = await createGeometryDeck({
        geometry: presetGeometry("star5"),
        level,
        extraProperties:
          '<a:ln w="50800"><a:solidFill><a:srgbClr val="1267B2"/></a:solidFill><a:round/></a:ln>',
      });
      const p = await parseDeck(bytes),
        sh = P.getSlideShapes(P.getSlides(p)[0])[0];
      expect(P.getShapePreset(sh)).toBeNull();
      expect(P.getShapeStrokeJoin(sh)).toBe("round");
      expect(P.getShapeStrokeJoinResolved(sh)).toEqual({
        kind: "miter",
        limit: 8,
      });
    },
  );
  it("an own custom geometry blocks an ancestor's exceptional preset", async () => {
    const p = await parseDeck(
      await createGeometryDeck({
        geometry: presetGeometry("star5"),
        directGeometry: triangleGeometry,
        extraProperties: lineProperties("<a:round/>"),
      }),
    );
    expect(
      P.getShapeStrokeJoinResolved(P.getSlideShapes(P.getSlides(p)[0])[0]),
    ).toEqual({ kind: "round" });
  });
  it.each(["", '<a:miter lim="350000"/>', "<a:bevel/>"])(
    "inherits nearest join choice %s independently from local width",
    async (local) => {
      const f = await lineFormattingFixture({
        local: lineProperties(local),
        layout: lineProperties("<a:round/>"),
        master: lineProperties('<a:miter lim="900000"/>'),
      });
      expect(P.getShapeStrokeJoinResolved(f.shape)).toEqual(
        local.includes("miter")
          ? { kind: "miter", limit: 3.5 }
          : local.includes("bevel")
            ? { kind: "bevel" }
            : { kind: "round" },
      );
    },
  );
  it("uses a style matrix's explicit join before a farther placeholder", async () => {
    const f = await lineFormattingFixture({
      local: lineProperties(),
      localStyle: lineStyleRef(2),
      layout: lineProperties("<a:round/>"),
      themeLines: lineProperties("<a:round/>") + lineProperties("<a:bevel/>"),
    });
    expect(P.getShapeStrokeJoinResolved(f.shape)).toEqual({ kind: "bevel" });
  });
  it.each(["", ' lim="bad"', ' lim="75%"', ' lim="0"'])(
    "preserves an explicit miter's native limit for %s",
    async (attrs) => {
      const f = await lineFormattingFixture({
        local: lineProperties(`<a:miter${attrs}/>`),
      });
      expect(P.getShapeStrokeJoinResolved(f.shape)).toEqual({
        kind: "miter",
        limit: attrs.includes("75%") ? 0.75 : attrs.includes('"0"') ? 0 : 8,
      });
    },
  );
  it("reads changed layout geometry without retaining a previous preset decision", async () => {
    const p = await parseDeck(
        await createGeometryDeck({
          geometry: presetGeometry("star5"),
          extraProperties: lineProperties("<a:round/>"),
        }),
      ),
      s = P.getSlides(p)[0],
      sh = P.getSlideShapes(s)[0];
    expect(P.getShapeStrokeJoinResolved(sh)).toEqual({
      kind: "miter",
      limit: 8,
    });
    const part = P._internalPackageOf(p).getPart(
      P.getSlideLayoutPartName(P.getSlideLayout(s)),
    );
    part.data = strToU8(
      strFromU8(part.data).replace('prst="star5"', 'prst="rect"'),
    );
    expect(P.getShapeStrokeJoinResolved(sh)).toEqual({ kind: "round" });
  });
  it("keeps resolved defaults through grouping, save and bidirectional transfer", async () => {
    const source = await parseDeck(await strokeJoinFixture()),
      s = P.getSlides(source)[0],
      before = outlines(source, s);
    P.groupShapes(P.getSlideShapes(s).slice(0, 2));
    expect(outlines(source, s)).toEqual(before);
    const check = async (p) => {
      const saved = await parseDeck(await P.savePresentation(p));
      expect(outlines(saved, P.getSlides(saved).at(-1))).toEqual(before);
      return saved;
    };
    await check(source);
    const target = createDeck("blank"),
      copied = P.importSlide(target, s, P.getSlideLayouts(target)[0], {
        preservePaintFormatting: true,
        preserveTextFormatting: true,
      });
    const loaded = await check(target),
      returned = createDeck("blank");
    P.importSlide(
      returned,
      P.getSlides(loaded).at(-1),
      P.getSlideLayouts(returned)[0],
      { preservePaintFormatting: true, preserveTextFormatting: true },
    );
    await check(returned);
  });
});
