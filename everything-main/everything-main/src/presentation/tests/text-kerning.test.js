import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import native from "./data/text-kerning-native.json";
import { textKerning } from "../lib/pptx-preview/src/text-kerning.ts";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";
import { P, createDeck, parseDeck } from "../src/model.js";

async function fixture({
  size = 24,
  kern = 2000,
  scale = 1,
  inherited = false,
} = {}) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  const sh = P.addSlideTextBox(s, {
    x: 0,
    y: 0,
    w: P.inches(5),
    h: P.inches(2),
    text: "AVATAR",
  });
  P.setShapeTextFormat(sh, { font: "Arial", size, kern });
  P.setShapeTextAutoFit(sh, "normal");
  const parts = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1);
  let xml = strFromU8(parts[name]).replace(
    "<a:normAutofit/>",
    `<a:normAutofit fontScale="${scale * 100000}"/>`,
  );
  if (inherited)
    xml = xml
      .replace(`kern="${kern}"`, "")
      .replace("<a:p>", `<a:p><a:pPr><a:defRPr kern="${kern}"/></a:pPr>`);
  parts[name] = strToU8(xml);
  return parseDeck(zipSync(parts));
}
function render(p, textLayout) {
  const specs = [];
  const svg = renderSlideToSvg(p, P.getSlides(p)[0], {
    textLayout,
    stableDefinitionIds: true,
    measureText: (text, spec) => {
      specs.push(spec);
      return { widthPx: text.length * spec.sizePx * 0.5 };
    },
  });
  return { svg, specs };
}

describe("run kerning thresholds", () => {
  it.each([false, true])(
    "uses font-provider kerning consistently for measurement and both painters without editing XML (table=%s)",
    async (table) => {
      const p = await fixture({ size: 24, kern: 1200 });
      if (table) {
        const shape = P.addSlideTable(P.getSlides(p)[0], {
          x: 0,
          y: P.inches(3),
          w: P.inches(5),
          h: P.inches(1),
          rows: [["Table AVATAR"]],
        });
        P.setTableCellTextFormat(P.getTableCell(shape, 0, 0), {
          font: "Arial",
          size: 24,
          kern: 1200,
          bold: true,
          italic: true,
        });
      }
      const before = unzipSync(await P.savePresentation(p));
      const received = [];
      for (const textLayout of ["svg", "foreignObject"]) {
        const svg = renderSlideToSvg(p, P.getSlides(p)[0], {
          textLayout,
          resolveFontFamily: () => "Independent font provider",
          resolveFontKerning: (spec) => {
            received.push(spec);
            return "none";
          },
          measureText: (text, spec) => {
            expect(spec.kerning).toBe("none");
            return { widthPx: text.length * 10 };
          },
        });
        expect(svg).toContain("font-kerning:none");
        expect(svg).not.toContain("font-kerning:normal");
      }
      expect(
        received.some(
          (spec) =>
            spec.family === "Independent font provider" &&
            spec.sizePx === 32 &&
            spec.kerning === "normal",
        ),
      ).toBe(true);
      if (table)
        expect(
          received.some(
            (spec) =>
              spec.bold &&
              spec.italic &&
              spec.family === "Independent font provider",
          ),
        ).toBe(true);
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it.each(native.cases)("matches native kerning selection: $name", (row) => {
    expect(textKerning(row.size * (row.scale ?? 1), row.threshold)).toBe(
      row.expected,
    );
  });
  it.each([false, true])(
    "uses effective formatting in both text renderers (inherited=%s)",
    async (inherited) => {
      const p = await fixture({ size: 18, kern: 2000, inherited });
      const before = unzipSync(await P.savePresentation(p));
      for (const mode of ["svg", "foreignObject"]) {
        const result = render(p, mode);
        expect(result.svg).toContain("font-kerning:none");
        if (mode === "svg")
          expect(
            result.specs.some((s) => s.sizePx === 24 && s.kerning === "none"),
          ).toBe(true);
      }
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
    },
  );
  it("evaluates the threshold after autofit and preserves it on export and cross-deck copy", async () => {
    const p = await fixture({ size: 24, kern: 2000, scale: 0.5 });
    for (const mode of ["svg", "foreignObject"])
      expect(render(p, mode).svg).toContain("font-kerning:none");
    const before = render(p, "svg").svg;
    const reloaded = await parseDeck(await P.savePresentation(p));
    expect(render(reloaded, "svg").svg).toBe(before);
    const target = createDeck("blank"),
      old = P.getSlides(target)[0];
    const copied = P.importSlide(
      target,
      P.getSlides(p)[0],
      P.getSlideLayouts(target)[0],
    );
    P.removeSlide(target, old);
    const shape = P.getSlideShapes(copied).find(
      (s) => P.getShapeText(s) === "AVATAR",
    );
    expect(P.getShapeRunFormat(shape, 0, 0).kern).toBe(2000);
    expect(render(target, "svg").svg).toContain("font-kerning:none");
  });
  it("enables kerning at an exact positive threshold", async () => {
    const p = await fixture({ size: 12, kern: 1200 });
    for (const mode of ["svg", "foreignObject"])
      expect(render(p, mode).svg).toContain("font-kerning:normal");
  });
});
