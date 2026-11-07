import { P, createDeck, parseDeck } from "../src/model.js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export const hyphenLineBreakCases = [
  {
    label: "Compound",
    text: "alpha beta-gamma delta",
    width: 205,
    lines: ["alpha beta-", "gamma delta"],
  },
  {
    label: "Unicode hyphen",
    text: "alpha beta‐gamma delta",
    width: 205,
    lines: ["alpha", "beta‐gamma", "delta"],
  },
  {
    label: "Nonbreaking hyphen",
    text: "alpha beta‑gamma delta",
    width: 205,
    lines: ["alpha", "beta‑gamma", "delta"],
  },
  {
    label: "Minus",
    text: "alpha -1234 delta",
    width: 155,
    lines: ["alpha -", "1234 delta"],
  },
  {
    label: "Numeric suffix",
    text: "alpha beta-12 delta",
    width: 205,
    lines: ["alpha beta-12", "delta"],
  },
  {
    label: "Repeated hyphens",
    text: "alpha beta--gamma delta",
    width: 220,
    lines: ["alpha beta--", "gamma delta"],
  },
  {
    label: "Joiner after hyphen",
    text: "alpha beta-\u2060gamma delta",
    width: 205,
    lines: ["alpha beta-", "\u2060gamma delta"],
  },
  {
    label: "Nonbreaking space",
    text: "alpha beta\u00a0gamma delta",
    width: 210,
    lines: ["alpha", "beta\u00a0gamma", "delta"],
  },
  {
    label: "Word joiner",
    text: "alpha beta\ufeffgamma delta",
    width: 205,
    lines: ["alpha", "beta\ufeffgamma", "delta"],
  },
  {
    label: "Comma after hyphen",
    text: "alpha beta-,gamma delta",
    width: 205,
    lines: ["alpha beta-", ",gamma delta"],
  },
  {
    label: "Narrow space boundary",
    text: "alpha beta gamma",
    width: 151,
    lines: ["alpha beta", "gamma"],
  },
  {
    label: "Wider space boundary",
    text: "alpha beta gamma",
    width: 160,
    lines: ["alpha beta", "gamma"],
  },
  {
    label: "Unwrapped",
    text: "alpha beta-gamma delta",
    width: 205,
    wrap: false,
    lines: ["alpha beta-gamma delta"],
  },
];

export async function hyphenLineBreakFixture() {
  const pres = createDeck("blank"),
    slide = P.getSlides(pres)[0];
  for (const [i, c] of hyphenLineBreakCases.entries())
    P.addSlideTextBox(slide, {
      x: P.inches(i % 2 ? 6.5 : 0.6),
      y: P.inches(0.5 + Math.floor(i / 2) * 1.02),
      w: Math.round((c.width * 9525 * 2) / 3),
      h: P.inches(0.94),
      text: c.text,
    });
  const files = unzipSync(await P.savePresentation(pres));
  const path = P.getSlidePartName(slide).slice(1);
  let index = 0;
  files[path] = strToU8(
    strFromU8(files[path]).replace(/<p:txBody>[\s\S]*?<\/p:txBody>/g, () => {
      const c = hyphenLineBreakCases[index++];
      return `<p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" wrap="${c.wrap === false ? "none" : "square"}"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr marL="0" marR="0" indent="0"><a:buNone/></a:pPr><a:r><a:rPr sz="1600"><a:latin typeface="Arial"/></a:rPr><a:t>${c.text}</a:t></a:r></a:p></p:txBody>`;
    }),
  );
  return parseDeck(zipSync(files));
}
