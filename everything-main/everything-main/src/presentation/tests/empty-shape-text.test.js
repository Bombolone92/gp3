import { describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck } from "../src/model.js";
import { resolveTextBodyModel } from "../lib/pptx-preview/src/render-slide.ts";
import { defaultMeasurer } from "../lib/pptx-preview/src/index.ts";

async function fixture(paragraphs) {
  const p = createDeck("blank"),
    s = P.getSlides(p)[0];
  P.addSlideShape(s, {
    x: 0,
    y: 0,
    w: P.inches(5),
    h: P.inches(3),
    preset: "rect",
  });
  const files = unzipSync(await P.savePresentation(p)),
    name = P.getSlidePartName(s).slice(1);
  files[name] = strToU8(
    strFromU8(files[name]).replace(
      "</p:sp>",
      `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`,
    ),
  );
  const loaded = await parseDeck(zipSync(files)),
    shape = P.getSlideShapes(P.getSlides(loaded)[0])[0];
  const theme = P.getPresentationTheme(loaded);
  const lookups = vi.spyOn(P._internalPackageOf(loaded).parts, "filter");
  const read = () =>
    resolveTextBodyModel(
      loaded,
      shape,
      { x: 0, y: 0, w: P.inches(5), h: P.inches(3) },
      theme,
      null,
      defaultMeasurer,
      "#000000",
      undefined,
      undefined,
      { date: new Date(2030, 0, 1), slideNumber: 7 },
    );
  return { read, lookups };
}

describe("empty decorative text bodies", () => {
  it.each(["<a:p/>", "<a:p><a:r><a:t/></a:r><a:br/></a:p><a:p/>"])(
    "skips font/style layout when only empty runs and breaks exist: %s",
    async (paragraphs) => {
      const { read, lookups } = await fixture(paragraphs);
      expect(read()).toBeNull();
      expect(lookups).not.toHaveBeenCalled();
    },
  );
  it("evaluates a slide number even when its cached display text is empty", async () => {
    const { read } = await fixture(
      '<a:p><a:fld id="{00000000-0000-0000-0000-000000000001}" type="slidenum"><a:rPr/><a:t/></a:fld></a:p>',
    );
    expect(read().paraData[0].runs.map((r) => r.text)).toEqual(["7"]);
  });
  it("retains leading and trailing blank paragraphs around real text", async () => {
    const { read } = await fixture(
      "<a:p/><a:p><a:r><a:t>visible</a:t></a:r></a:p><a:p/>",
    );
    expect(
      read().paraData.map((p) => p.runs.map((r) => r.text).join("")),
    ).toEqual(["", "visible", ""]);
  });
});
