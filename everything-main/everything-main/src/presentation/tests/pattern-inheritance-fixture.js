import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck } from "../src/model.js";

export const pattern = (preset, foreground, background) =>
  `<a:pattFill${preset === undefined ? "" : ` prst="${preset}"`}>${foreground === undefined ? "" : `<a:fgClr>${foreground}</a:fgClr>`}${background === undefined ? "" : `<a:bgClr>${background}</a:bgClr>`}</a:pattFill>`;
export const rgb = (color, alpha = 100000) =>
  `<a:srgbClr val="${color}">${alpha === 100000 ? "" : `<a:alpha val="${alpha}"/>`}</a:srgbClr>`;
export const patternStyle = (index, color) =>
  index === undefined
    ? ""
    : `<p:style><a:lnRef idx="0"><a:srgbClr val="000000"/></a:lnRef><a:fillRef idx="${index}">${color}</a:fillRef><a:effectRef idx="0"><a:srgbClr val="000000"/></a:effectRef><a:fontRef idx="minor"><a:srgbClr val="000000"/></a:fontRef></p:style>`;

const red = rgb("C43169", 40000),
  green = rgb("27A85F", 70000),
  blue = rgb("2763C4", 60000),
  gold = rgb("D7A82B", 80000),
  solid = `<a:solidFill>${rgb("8A43B5")}</a:solidFill>`,
  master = pattern("horzBrick", blue, gold),
  layout = pattern("lgConfetti", green),
  ownStyle = 1;

// Distinct, conflicting declarations expose precedence without depending on
// the source corpus, shape IDs, theme defaults or a renderer's merge helper.
export const patternInheritanceCases = [
  { name: "own empty uses style", own: pattern(), ownStyle },
  { name: "own preset uses style channels", own: pattern("divot"), ownStyle },
  {
    name: "own foreground uses style background",
    own: pattern(undefined, red),
    ownStyle,
  },
  {
    name: "own background uses style foreground",
    own: pattern(undefined, undefined, red),
    ownStyle,
  },
  {
    name: "own empty uses layout",
    own: pattern(),
    layout: pattern("lgConfetti", green, blue),
  },
  { name: "own preset merges resolved layout", own: pattern("divot"), layout },
  { name: "layout missing background uses master", own: pattern(), layout },
  {
    name: "layout style precedes master",
    own: pattern(),
    layout,
    layoutStyle: 2,
  },
  { name: "own style precedes layout", own: pattern(), ownStyle, layout },
  {
    name: "own solid style allows same-kind layout",
    own: pattern(),
    ownStyle: 3,
    layout,
  },
  {
    name: "own zero style allows same-kind layout",
    own: pattern(),
    ownStyle: 0,
    layout,
  },
  { name: "layout solid blocks master", own: pattern(), layout: solid },
  {
    name: "layout noFill blocks master",
    own: pattern(),
    layout: "<a:noFill/>",
  },
  { name: "own noFill blocks pattern", own: "<a:noFill/>", ownStyle, layout },
  { name: "own solid blocks pattern", own: solid, ownStyle, layout },
  { name: "missing own uses partial own style", ownStyle: 2, layout },
  { name: "missing own and style uses layout", layout },
  { name: "missing layout uses master", own: pattern() },
  {
    name: "zero foreground alpha still overrides",
    own: pattern("wave", rgb("AB3D76", 0)),
    layout,
  },
  {
    name: "complete own stays independent",
    own: pattern("sphere", red, blue),
    ownStyle,
    layout,
  },
];

// Native controls establish these channel/preset combinations independently.
const expected = (preset, foreground, background, fa = 1, ba = 1) => ({
  preset,
  foreground: `#${foreground}`,
  background: `#${background}`,
  ...(fa === 1 ? {} : { foregroundOpacity: fa }),
  ...(ba === 1 ? {} : { backgroundOpacity: ba }),
});
export const patternInheritanceExpected = [
  expected("weave", "C43169", "2763C4", 0.4, 0.6),
  expected("divot", "C43169", "2763C4", 0.4, 0.6),
  expected("weave", "C43169", "2763C4", 0.4, 0.6),
  expected("weave", "C43169", "C43169", 0.4, 0.4),
  expected("lgConfetti", "27A85F", "2763C4", 0.7, 0.6),
  expected("divot", "27A85F", "D7A82B", 0.7, 0.8),
  expected("lgConfetti", "27A85F", "D7A82B", 0.7, 0.8),
  expected("lgConfetti", "27A85F", "27A85F", 0.7, 0.7),
  expected("weave", "C43169", "2763C4", 0.4, 0.6),
  expected("lgConfetti", "27A85F", "D7A82B", 0.7, 0.8),
  expected("lgConfetti", "27A85F", "D7A82B", 0.7, 0.8),
  expected("pct5", "000000", "FFFFFF"),
  expected("pct5", "000000", "FFFFFF"),
  null,
  null,
  expected("lgConfetti", "D7A82B", "C43169", 0.8, 0.4),
  expected("lgConfetti", "27A85F", "D7A82B", 0.7, 0.8),
  expected("horzBrick", "2763C4", "D7A82B", 0.6, 0.8),
  expected("wave", "AB3D76", "D7A82B", 0, 0.8),
  expected("sphere", "C43169", "2763C4", 0.4, 0.6),
];

/** One reusable native placeholder matrix; all partial fills remain authored. */
export async function patternInheritanceDeck(
  cases = patternInheritanceCases,
  { masterFill = master, masterStyle, fillStyles } = {},
) {
  const pres = createDeck("blank"),
    first = P.getSlides(pres)[0],
    layout = P.getSlideLayout(first);
  for (const [i] of cases.entries()) {
    const page = Math.floor(i / 8),
      slide = P.getSlides(pres)[page] ?? P.addSlide(pres, { layout });
    P.setSlideBackground(slide, "#DDE3EB");
    const shape = P.addSlideShape(slide, {
      x: P.pt(20 + (i % 4) * 235),
      y: P.pt(40 + (Math.floor(i / 4) % 2) * 240),
      w: P.pt(205),
      h: P.pt(180),
      preset: i % 2 ? "ellipse" : "rect",
    });
    P.setShapeFill(shape, "#FFFFFF");
  }
  const files = unzipSync(await P.savePresentation(pres)),
    slots = { layout: [], master: [] };
  let i = 0;
  for (const slide of P.getSlides(pres)) {
    const name = P.getSlidePartName(slide).slice(1);
    files[name] = strToU8(
      strFromU8(files[name]).replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) => {
        const c = cases[i],
          idx = i++;
        const slot = (fill, style, ref) =>
          shape
            .replace(
              /(<p:cNvPr\b[^>]*\bid=")\d+("[\s\S]*?)/,
              (_, a, b) => `${a}${idx + 2}${b}`,
            )
            .replace(
              "<p:nvPr/>",
              `<p:nvPr><p:ph type="body" idx="${idx}"/></p:nvPr>`,
            )
            .replace(/<a:solidFill\b[\s\S]*?<\/a:solidFill>/, fill ?? "")
            .replace(/<p:style\b[\s\S]*?<\/p:style>/, "")
            .replace("</p:spPr>", `</p:spPr>${patternStyle(style, ref)}`);
        slots.layout.push(slot(c.layout, c.layoutStyle, green));
        if (idx === 0) slots.master.push(slot(masterFill, masterStyle, gold));
        return slot(c.own, c.ownStyle, red);
      }),
    );
  }
  for (const [kind, name] of [
    ["layout", P.getSlideLayoutPartName(layout)],
    ["master", P.getSlideMasterPartName(first)],
  ])
    files[name.slice(1)] = strToU8(
      strFromU8(files[name.slice(1)])
        .replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, "")
        .replace("</p:spTree>", `${slots[kind].join("")}</p:spTree>`),
    );
  const theme = Object.keys(files).find((n) =>
    /^ppt\/theme\/theme\d+\.xml$/.test(n),
  );
  files[theme] = strToU8(
    strFromU8(files[theme]).replace(
      /<a:fillStyleLst>[\s\S]*?<\/a:fillStyleLst>/,
      `<a:fillStyleLst>${fillStyles ?? `${pattern("weave", '<a:schemeClr val="phClr"/>', blue)}${pattern(undefined, gold, '<a:schemeClr val="phClr"/>')}${solid}`}</a:fillStyleLst>`,
    ),
  );
  return zipSync(files);
}
