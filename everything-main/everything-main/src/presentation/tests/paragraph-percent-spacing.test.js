import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  P,
  createDeck,
  parseDeck,
  textRuns,
  setRichText,
  textParagraphSpacing,
} from "../src/model.js";
import { renderSlideToSvg } from "../lib/pptx-preview/src/index.ts";

import native from "./data/paragraph-percent-height-native.json";
import { layoutCore } from "../lib/pptx-preview/src/text-layout.ts";
import { fitDiagramTextHeightRule } from "../lib/pptx/src/internal/diagram/rule-fit.ts";

const run = (text, size = 18) =>
  `<a:r><a:rPr sz="${size * 100}"><a:latin typeface="Arial"/></a:rPr><a:t>${text}</a:t></a:r>`;
const space = (side, value, kind = "Pct") =>
  `<a:spc${side}><a:spc${kind} val="${value}"/></a:spc${side}>`;
async function fixture({
  local = "",
  defaults = "",
  table = false,
  body = "",
  content = [run("First"), run("Second")],
} = {}) {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  if (table)
    P.addSlideTable(slide, {
      x: 0,
      y: 0,
      w: P.inches(5),
      h: P.inches(3),
      rows: [["seed"]],
    });
  else
    P.addSlideTextBox(slide, {
      x: 0,
      y: 0,
      w: P.inches(5),
      h: P.inches(3),
      text: "seed",
    });
  const files = unzipSync(await P.savePresentation(pres));
  const tag = table ? "a" : "p";
  const xml = `<${tag}:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" compatLnSpc="0" ${body}/><a:lstStyle><a:lvl1pPr>${defaults}</a:lvl1pPr></a:lstStyle>${content.map((text) => `<a:p><a:pPr>${local}</a:pPr>${text}</a:p>`).join("")}</${tag}:txBody>`;
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"]).replace(
      new RegExp(`<${tag}:txBody>[\\s\\S]*?</${tag}:txBody>`),
      xml,
    ),
  );
  const p = await parseDeck(zipSync(files)),
    s = P.getSlides(p)[0],
    shape = P.getSlideShapes(s)[0];
  return { p, s, shape };
}
const measure = (text, spec) => ({
  widthPx: (text.length * spec.sizePx) / 2,
  ascentPx: spec.sizePx * 0.9,
  descentPx: spec.sizePx * 0.2,
  lineGapPx: spec.sizePx * 0.05,
});
const render = ({ p, s }, textLayout = "svg") =>
  renderSlideToSvg(p, s, {
    textLayout,
    measureText: measure,
    resolveFontFamily: () => "Arial",
  });

describe("paragraph percentage units", () => {
  it.each([
    ["35000", 0.35],
    ["35%", 0.35],
    ["0", 0],
    ["1", 0.00001],
    ["100000", 1],
  ])(
    "reads %s without confusing fractions, points, or inheritance",
    async (raw, expected) => {
      const f = await fixture({
        local: space("Bef", raw),
        defaults: space("Bef", 1200, "Pts") + space("Aft", 700, "Pts"),
      });
      expect(P.getParagraphSpacing(f.shape, 0)).toEqual({
        beforePts: null,
        afterPts: null,
        beforePct: expected,
      });
      expect(P.getParagraphPropertiesEffective(f.p, f.shape, 0)).toMatchObject({
        spcBefPts: null,
        spcBefPct: expected,
        spcAftPts: 7,
      });
    },
  );
  it("a point-valued override also replaces an inherited percentage atomically", async () => {
    const f = await fixture({
      local: space("Bef", 0, "Pts"),
      defaults: space("Bef", 75000) + space("Aft", 25000),
    });
    const properties = P.getParagraphPropertiesEffective(f.p, f.shape, 0);
    expect(properties.spcBefPts).toBe(0);
    expect(properties.spcBefPct).toBeUndefined();
    expect(properties.spcAftPct).toBe(0.25);
  });
  it.each(["", "%", "  %", "garbage", "-1000", "Infinity", "12x"])(
    "ignores malformed percentage %s and keeps valid inherited spacing",
    async (raw) => {
      const f = await fixture({
        local: space("Aft", raw),
        defaults: space("Aft", 600, "Pts"),
      });
      expect(P.getParagraphPropertiesEffective(f.p, f.shape, 0).spcAftPts).toBe(
        6,
      );
    },
  );
  it("writes independent units, preserves omitted sides, clears a side, and validates before mutation", async () => {
    const { shape } = await fixture();
    P.setParagraphSpacing(shape, 0, { beforePct: 0.35, afterPts: 7 });
    P.setParagraphSpacing(shape, 0, { afterPts: 0 });
    expect(P.getParagraphSpacing(shape, 0)).toEqual({
      beforePts: null,
      beforePct: 0.35,
      afterPts: 0,
    });
    const before = P.getShapeXmlString(shape);
    for (const change of [
      { beforePts: 4, afterPct: NaN },
      { beforePct: -1 },
      { afterPts: 2, afterPct: 0.5 },
    ]) {
      expect(() => P.setParagraphSpacing(shape, 0, change)).toThrow(RangeError);
      expect(P.getShapeXmlString(shape)).toBe(before);
    }
    P.setParagraphSpacing(shape, 0, { beforePct: null });
    expect(P.getParagraphSpacing(shape, 0)).toEqual({
      beforePts: null,
      afterPts: 0,
    });
  });
  it("shares unit parsing with line spacing including percent strings and tiny values", async () => {
    const f = await fixture({
      local: '<a:lnSpc><a:spcPct val="125%"/></a:lnSpc>',
    });
    expect(P.getParagraphLineSpacing(f.shape, 0)).toEqual({
      kind: "pct",
      value: 1.25,
    });
    expect(
      P.getParagraphPropertiesEffective(f.p, f.shape, 0).lineSpacing,
    ).toEqual({ kind: "pct", value: 1.25 });
  });
  it.each([false, true])(
    "renders inherited percentage margins in both text paths (table: %s)",
    async (table) => {
      const f = await fixture({ table, defaults: space("Aft", 50000) });
      const html = render(f, "foreignObject");
      const expected = table ? 14.4 : 13.8; // cell compatible height vs font metrics
      const margin = html.match(
        table ? /margin:0px 0px ([\d.]+)px 0px/ : /margin-bottom:([\d.]+)px/,
      );
      expect(Number(margin?.[1])).toBeCloseTo(expected);
      const before = unzipSync(await P.savePresentation(f.p));
      expect(render(f)).toContain("Second");
      expect(unzipSync(await P.savePresentation(f.p))).toEqual(before);
    },
  );
  it("preserves percentages through text edits, a one-sided spacing edit, copying and export", async () => {
    const f = await fixture({
      local: space("Bef", 25000) + space("Aft", 35000),
    });
    const paragraphs = textRuns(f.p, f.shape);
    expect(paragraphs[0]).toMatchObject({
      spaceBeforePct: 0.25,
      spaceAfterPct: 0.35,
    });
    expect(
      textParagraphSpacing(f.p, f.shape, paragraphs)[0].afterPx,
    ).toBeGreaterThan(0);
    paragraphs[0].runs[0].text = "Edited";
    paragraphs[0].spaceBefore = 0;
    paragraphs[0].spaceBeforePct = undefined;
    paragraphs[0].spacingChanged = true;
    paragraphs[0].spaceBeforeChanged = true;
    setRichText(f.shape, paragraphs);
    expect(P.getParagraphSpacing(f.shape, 0)).toEqual({
      beforePts: 0,
      afterPts: null,
      afterPct: 0.35,
    });
    let source = f.s;
    for (let i = 0; i < 2; i++) {
      const target = createDeck("blank");
      P.importSlide(target, source, P.getSlideLayouts(target)[0]);
      const restored = await parseDeck(await P.savePresentation(target));
      source = P.getSlides(restored).at(-1);
      const copy = P.getSlideShapes(source)[0];
      expect(P.getParagraphSpacing(copy, 0)).toEqual({
        beforePts: 0,
        afterPts: null,
        afterPct: 0.35,
      });
      expect(P.getShapeText(copy)).toContain("Edited");
    }
  });
});

// Native height is expected output, never an input to measurement or search.
it.each(native.cases)(
  "matches independently captured native paragraph height: $name",
  (row) => {
    const input = { ...native.base, ...row.input };
    const core = layoutCore(input, (text, spec) => {
      const result = native.measurements[JSON.stringify([text, spec])];
      if (!result) throw new Error("Unrecorded measurement");
      return result;
    });
    const requiredMM = (core.requiredH * 9525) / 36000;
    const fit = fitDiagramTextHeightRule(
      { current: 1, limit: Infinity, mode: "value" },
      (trial) => trial >= requiredMM,
    );
    expect(
      Math.abs(Math.round(fit.value * 36000) - row.expectedHeightEMU),
    ).toBeLessThanOrEqual(1);
  },
);

it("scales percentage spacing with autofit fonts while preserving fixed point spacing", async () => {
  const f = await fixture({
    local: space("Bef", 600, "Pts") + space("Aft", 50000),
    body: 'spcFirstLastPara="1"',
  });
  const files = unzipSync(await P.savePresentation(f.p));
  files["ppt/slides/slide1.xml"] = strToU8(
    strFromU8(files["ppt/slides/slide1.xml"]).replace(
      /<a:bodyPr([^>]*)\/>/,
      '<a:bodyPr$1><a:normAutofit fontScale="50000" lnSpcReduction="20000"/></a:bodyPr>',
    ),
  );
  const p = await parseDeck(zipSync(files)),
    s = P.getSlides(p)[0];
  const html = render({ p, s }, "foreignObject");
  expect(html).toContain("margin-top:8.00px");
  expect(html).toContain("margin-bottom:6.90px");
  expect(html).toContain("font-size:12.00px");
});

it.each([0, 600])(
  "table point spacing %s clears an inherited percentage",
  async (points) => {
    const f = await fixture({
      table: true,
      local: space("Aft", points, "Pts"),
      defaults: space("Aft", 50000),
    });
    const html = render(f, "foreignObject");
    const margin = html.match(/margin:0px 0px ([\d.]+)px 0px/);
    expect(Number(margin?.[1])).toBeCloseTo(((points / 100) * 4) / 3);
  },
);
