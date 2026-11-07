import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { parseXml } from "../lib/pptx/src/internal/xml/index.ts";
import {
  resolveDrawingColor,
  resolveDrawingOpacity,
} from "../lib/pptx/src/api/fn/shape-color.ts";

const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
const transforms = (ops) =>
  ops
    .map(
      ([name, value]) =>
        `<a:${name}${value === null ? "" : ` val="${value}"`}/>`,
    )
    .join("");
const element = (base, ops) =>
  parseXml(
    `<a:srgbClr xmlns:a="${ns}" val="${base}">${transforms(ops)}</a:srgbClr>`,
  ).root;
// Solid-color controls authored here and exported by the native reference.
// HSL conversion can differ by one 8-bit channel step at rounding boundaries.
const nativeCases = [
  ["000000", [["tint", 75000]], "#898989"],
  ["000000", [["tint", 50000]], "#BCBCBC"],
  ["FF0000", [["tint", 50000]], "#FFBCBC"],
  ["FF0000", [["tint", 15000]], "#FFEDED"],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
    ],
    "#FF7878",
  ],
  ["336699", [["tint", 75000]], "#8FA0BA"],
  ["336699", [["shade", 50000]], "#23496F"],
  ["FFFFFF", [["shade", 50000]], "#BCBCBC"],
  ["FF0000", [["shade", 50000]], "#BC0000"],
  ["336699", [["satMod", 200000]], "#0066CC"],
  ["336699", [["lumMod", 50000]], "#19334D"],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["lumMod", 50000],
    ],
    "#DD0000",
  ],
  ["808080", [["tint", 75000]], "#ACACAC"],
  [
    "FF0000",
    [
      ["tint", 100000],
      ["shade", 100000],
      ["satMod", 130000],
    ],
    "#FF0000",
  ],
  [
    "FF0000",
    [
      ["tint", 15000],
      ["satMod", 350000],
    ],
    "#FFD7D7",
  ],
  ["0000FF", [["tint", 50000]], "#BCBCFF"],
  [
    "336699",
    [
      ["shade", 50000],
      ["tint", 50000],
    ],
    "#BDC1C8",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
      ["lumMod", 50000],
    ],
    "#BC0000",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
      ["tint", 50000],
    ],
    "#FFCBCB",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
      ["shade", 50000],
    ],
    "#BC5656",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
      ["satMod", 50000],
    ],
    "#DD9A9A",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
      ["hueOff", 7200000],
    ],
    "#78FF78",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
      ["inv", null],
    ],
    "#00E9E9",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satOff", 50000],
    ],
    "#FFABAB",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satOff", -50000],
    ],
    "#EECCCC",
  ],
  ["FF0000", [["satOff", 50000]], "#FF0000"],
  [
    "336699",
    [
      ["satMod", 300000],
      ["lumMod", 50000],
    ],
    "#00337F",
  ],
  [
    "336699",
    [
      ["satMod", 300000],
      ["tint", 50000],
    ],
    "#BCC6FF",
  ],
  [
    "66AA99",
    [
      ["satMod", 400000],
      ["hueOff", 3600000],
    ],
    "#0033FF",
  ],
  [
    "FF0000",
    [
      ["satMod", 1000000],
      ["lumMod", 50000],
    ],
    "#7F0000",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 200000],
      ["satMod", 200000],
    ],
    "#FF6767",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 400000],
    ],
    "#FF5656",
  ],
  ["808080", [["satOff", 100000]], "#FF0100"],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 0],
    ],
    "#DDDDDD",
  ],
  ["000000", [["inv", null]], "#FFFFFF"],
  ["FFFFFF", [["inv", null]], "#000000"],
  ["FF0000", [["inv", null]], "#00FFFF"],
  ["00FF00", [["inv", null]], "#FF00FF"],
  ["0000FF", [["inv", null]], "#FFFF00"],
  ["808080", [["inv", null]], "#E5E5E5"],
  ["336699", [["inv", null]], "#FBEFD7"],
  ["123456", [["inv", null]], "#FEFBF4"],
  ["ABCDEF", [["inv", null]], "#CAA867"],
  ["F02040", [["inv", null]], "#64FDF9"],
  ["010203", [["inv", null]], "#FFFFFF"],
  ["FEFDFC", [["inv", null]], "#18242D"],
  [
    "336699",
    [
      ["inv", null],
      ["inv", null],
    ],
    "#336699",
  ],
  [
    "336699",
    [
      ["inv", null],
      ["shade", 50000],
    ],
    "#B9B09E",
  ],
  [
    "336699",
    [
      ["tint", 50000],
      ["inv", null],
    ],
    "#B9B09E",
  ],
  [
    "000000",
    [
      ["inv", null],
      ["alpha", 50000],
    ],
    "#FFFFFF",
  ],
  [
    "FF0000",
    [
      ["tint", 50000],
      ["satMod", 300000],
      ["inv", null],
    ],
    "#00E9E9",
  ],
];

describe("DrawingML saturation and inversion", () => {
  it.each(nativeCases)(
    "matches native transforms for %s, %j",
    (base, ops, expected) => {
      const node = element(base, ops),
        before = structuredClone(node);
      const actual = resolveDrawingColor(node, null);
      expect(actual).toMatch(/^#[0-9A-F]{6}$/);
      for (const offset of [1, 3, 5])
        expect(
          Math.abs(
            parseInt(actual.slice(offset, offset + 2), 16) -
              parseInt(expected.slice(offset, offset + 2), 16),
          ),
        ).toBeLessThanOrEqual(1);
      expect(node).toEqual(before);
    },
  );
  it("resolves mapped theme colors before applying over-saturation and inversion", () => {
    const node = parseXml(
      `<a:schemeClr xmlns:a="${ns}" val="tx1"><a:tint val="50000"/><a:satMod val="300000"/><a:inv/></a:schemeClr>`,
    ).root;
    expect(
      resolveDrawingColor(node, { accent1: "#FF0000" }, { tx1: "accent1" }),
    ).toBe("#00E9E9");
  });
  it("keeps alpha independent of the transformed RGB channels", () => {
    const node = element("336699", [
      ["inv", null],
      ["alpha", 50000],
      ["alphaMod", 40000],
    ]);
    expect(resolveDrawingColor(node, null)).toBe("#FBEFD7");
    expect(resolveDrawingOpacity(node)).toBeCloseTo(0.2);
  });
  it("handles percentage spellings, zero saturation, and large finite factors", () => {
    expect(
      resolveDrawingColor(
        element("FF0000", [
          ["tint", "50%"],
          ["satMod", "300%"],
        ]),
        null,
      ),
    ).toBe("#FF7878");
    expect(resolveDrawingColor(element("336699", [["satMod", 0]]), null)).toBe(
      "#666666",
    );
    expect(
      resolveDrawingColor(element("6699AA", [["satMod", 1000000000]]), null),
    ).toMatch(/^#[0-9A-F]{6}$/);
  });
  it.each([
    [
      "FF0000",
      [
        ["tint", 50000],
        ["satMod", 300000],
        ["inv", null],
      ],
      "#00E9E9",
    ],
    ["808080", [["satOff", 20000]], "#996701"],
    ["808080", [["satOff", -20000]], "#6799FF"],
  ])(
    "preserves %s with %j through edit, copy and export",
    async (base, ops, expected) => {
      const original = createDeck("blank"),
        slide = P.getSlides(original)[0];
      P.addSlideTextBox(slide, {
        x: 0,
        y: 0,
        w: P.inches(3),
        h: P.inches(2),
        text: "Probe",
      });
      const files = unzipSync(await P.savePresentation(original)),
        name = P.getSlidePartName(slide).slice(1);
      const color = `<a:srgbClr val="${base}">${transforms(ops)}</a:srgbClr>`;
      files[name] = strToU8(
        strFromU8(files[name]).replace(
          /<p:sp\b[\s\S]*?<\/p:sp>/,
          `<p:sp><p:nvSpPr><p:cNvPr id="90" name="Probe"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill>${color}</a:solidFill><a:ln w="12700"><a:solidFill>${color}</a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"><a:solidFill>${color}</a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>Probe</a:t></a:r></a:p></p:txBody></p:sp>`,
        ),
      );
      const p = await parseDeck(zipSync(files)),
        s = P.getSlides(p)[0],
        shape = P.getSlideShapes(s)[0];
      const check = (pres, target) => {
        expect(P.getShapeFillColorResolved(pres, target)).toBe(expected);
        expect(P.getShapeStrokeColorResolved(pres, target)).toBe(expected);
        expect(P.getShapeRunFormatEffective(pres, target, 0, 0).color).toBe(
          expected,
        );
        expect(P.getShapeRunFormat(target, 0, 0).color).toBe(`#${base}`);
      };
      const before = unzipSync(await P.savePresentation(p));
      check(p, shape);
      expect(decodeURIComponent(preview(p, s))).toContain(expected);
      expect(unzipSync(await P.savePresentation(p))).toEqual(before);
      check(p, P.copyShape(s, shape));
      const target = createDeck("blank"),
        imported = P.importSlide(
          target,
          s,
          P.getSlideLayout(P.getSlides(target)[0]),
        );
      const copy = P.getSlideShapes(imported)[0];
      P.setShapeText(copy, "Edited");
      check(target, copy);
      const returned = P.importSlide(p, imported, P.getSlideLayout(s));
      check(p, P.getSlideShapes(returned)[0]);
      const reopened = await parseDeck(await P.savePresentation(p));
      check(reopened, P.getSlideShapes(P.getSlides(reopened).at(-1))[0]);
    },
  );
});

describe("achromatic DrawingML saturation", () => {
  // Full-coverage pixels from native reference exports, not samples from this
  // resolver. These controls expose the undefined-hue behavior independently
  // of SmartArt. Exact assertions deliberately do not allow one-channel error.
  it.each([
    ["808080", [["satOff", 20000]], "#996701"],
    ["808080", [["satOff", 40000]], "#B34D00"],
    ["808080", [["satOff", 100000]], "#FF0100"],
    [
      "808080",
      [
        ["hueOff", 14400000],
        ["satOff", 20000],
      ],
      "#996701",
    ],
    [
      "808080",
      [
        ["satOff", 20000],
        ["hueOff", 14400000],
      ],
      "#670199",
    ],
    ["808081", [["satOff", 20000]], "#67679A"],
    ["404040", [["satOff", 20000]], "#4D3300"],
    ["C0C0C0", [["satOff", 20000]], "#CDB381"],
    ["808080", [["satOff", -20000]], "#6799FF"],
    ["808080", [["satMod", 200000]], "#808080"],
    [
      "808080",
      [
        ["lumOff", 10000],
        ["satOff", 20000],
      ],
      "#AE8534",
    ],
    [
      "808080",
      [
        ["hueOff", 0],
        ["satOff", 20000],
        ["lumOff", -39],
        ["alphaOff", 0],
      ],
      "#996601",
    ],
    [
      "808080",
      [
        ["hueOff", 0],
        ["satOff", 100000],
        ["lumOff", -196],
        ["alphaOff", 0],
      ],
      "#FE0100",
    ],
  ])("matches native %s with %j exactly", (base, ops, expected) => {
    const node = element(base, ops),
      before = structuredClone(node);
    expect(resolveDrawingColor(node, null)).toBe(expected);
    expect(node).toEqual(before);
  });

  it("keeps zero-chroma luminance endpoints exact before later operations", () => {
    for (const base of ["000000", "FFFFFF"])
      for (const amount of [-300000, -40000, 20000, 40000, 300000]) {
        expect(
          resolveDrawingColor(element(base, [["satOff", amount]]), null),
        ).toBe(`#${base}`);
        // Subtracting/adding lightness must still produce equal RGB channels.
        const value = resolveDrawingColor(
          element(base, [
            ["satOff", amount],
            ["lumOff", base === "000000" ? 20000 : -20000],
          ]),
          null,
        );
        expect(value.slice(1, 3)).toBe(value.slice(3, 5));
        expect(value.slice(3, 5)).toBe(value.slice(5, 7));
      }
  });

  it("applies the same operation after resolving theme, system, preset and HSL colors", () => {
    for (const [tag, attrs] of [
      ["schemeClr", 'val="tx1"'],
      ["sysClr", 'val="windowText" lastClr="808080"'],
      ["prstClr", 'val="gray"'],
      ["hslClr", 'hue="14400000" sat="0" lum="50196"'],
    ]) {
      const node = parseXml(
        `<a:${tag} xmlns:a="${ns}" ${attrs}><a:satOff val="20000"/><a:alpha val="37000"/></a:${tag}>`,
      ).root;
      expect(
        resolveDrawingColor(node, { accent2: "#808080" }, { tx1: "accent2" }),
      ).toBe("#996701");
      expect(resolveDrawingOpacity(node)).toBe(0.37);
    }
  });
});
