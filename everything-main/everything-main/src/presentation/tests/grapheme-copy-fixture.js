import { P, createDeck } from "../src/model.js";
import { requireParagraph, runsOf } from "../lib/pptx/src/api/fn/shape-runs.ts";

export const copiedClusters = ["e\u0301", "か\u3099", "👩🏽‍💻", "🇨🇦", "1️⃣", "각"];
export function graphemeCopyDeck() {
  const p = createDeck("blank"),
    slide = P.getSlides(p)[0];
  for (const [i, cluster] of copiedClusters.entries()) {
    const sh = P.addSlideTextBox(slide, {
      x: P.inches(1 + 3 * (i % 3)),
      y: P.inches(0.5 + 3 * Math.floor(i / 3)),
      w: 4 * 12700,
      h: P.inches(2),
      text: cluster.repeat(2),
    });
    P.setShapeTextFormat(sh, { font: "Arial", size: 18, kern: 0 });
    P.setShapeTextMargins(sh, { left: 0, right: 0, top: 0, bottom: 0 });
    P.setShapeTextAutoFit(sh, "none");
    P.setShapeTextWrap(sh, "square");
    if (i === 0) {
      const para = requireParagraph(sh, 0),
        original = runsOf(para)[0];
      const texts = [...cluster.repeat(2)];
      para.children = texts.map(() => structuredClone(original));
      for (const [index, text] of texts.entries()) {
        P.setShapeRunText(sh, 0, index, text);
        if (index % 2)
          P.setShapeRunFormat(sh, 0, index, { italic: true, color: "#112233" });
      }
    }
  }
  return p;
}
