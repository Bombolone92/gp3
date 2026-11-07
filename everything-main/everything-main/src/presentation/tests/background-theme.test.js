import { expect, it } from "vitest";
import { P, createDeck, parseDeck, preview } from "../src/model.js";
import { importSlideTemplate } from "../lib/pptx/src/api/fn/template-import.ts";
import { backgroundThemeFixture } from "./background-theme-fixture.js";
import { INTERNAL_PACKAGE } from "../lib/pptx/src/api/_internal-symbols.ts";
import { resolveTarget } from "../lib/pptx/src/internal/opc/index.ts";
import { REL_TYPES } from "../lib/pptx/src/internal/presentationml/index.ts";

const copy = (target, slide) =>
  P.importSlide(target, slide, importSlideTemplate(target, slide), {
    preserveGeometry: false,
  });
const cases = ["slide", "layout", "master"].flatMap((level) =>
  ["solid", "gradient", "pattern"].map((kind) => ({ level, kind })),
);
it.each(cases)(
  "uses the owning theme for a $level $kind background across native template transfers",
  async ({ level, kind }) => {
    const source = await backgroundThemeFixture({ level, kind });
    const slide = P.getSlides(source)[0],
      target = createDeck("blank"),
      original = preview(source, slide),
      untouched = preview(target, P.getSlides(target)[0]),
      copied = copy(target, slide);
    expect(preview(target, copied)).toBe(original);
    expect(preview(target, P.getSlides(target)[0])).toBe(untouched);
    expect(P.getPresentationTheme(target)).not.toEqual(
      P.getPresentationTheme(source),
    );
    if (kind === "pattern") {
      const read = (p, s) => {
        const layout = P.getSlideLayout(s);
        return level === "slide"
          ? P.getSlideBackgroundPatternFill(p, s)
          : level === "layout"
            ? P.getSlideLayoutBackgroundPatternFill(p, layout)
            : P.getSlideMasterBackgroundPatternFill(p, layout);
      };
      expect(read(target, copied)).toEqual(read(source, slide));
    }
    const restored = await parseDeck(await P.savePresentation(target));
    expect(preview(restored, P.getSlides(restored)[1])).toBe(original);
    const returned = createDeck("blank"),
      back = copy(returned, P.getSlides(restored)[1]);
    expect(preview(returned, back)).toBe(original);
    expect(
      P.validatePresentation(restored).filter((x) => x.severity === "error"),
    ).toEqual([]);
  },
);

it("uses the owning theme's light color when no background is authored", async () => {
  const source = await backgroundThemeFixture({ kind: "inherit" });
  const target = createDeck("blank"),
    slide = copy(target, P.getSlides(source)[0]);
  expect(decodeURIComponent(preview(target, slide))).toContain(
    'fill="#E6F4DA"',
  );
});

it("observes an owning-theme edit without changing the other master", async () => {
  const source = await backgroundThemeFixture(),
    target = createDeck("blank"),
    slide = copy(target, P.getSlides(source)[0]);
  const other = preview(target, P.getSlides(target)[0]);
  expect(decodeURIComponent(preview(target, slide))).toContain(
    'fill="#EDE0E8"',
  );
  const pkg = target[INTERNAL_PACKAGE],
    layout = P.getSlideLayoutPartName(P.getSlideLayout(slide)),
    master = resolveTarget(
      layout,
      pkg.getRels(layout).items.find((x) => x.type === REL_TYPES.slideMaster)
        .target,
    ),
    themeName = resolveTarget(
      master,
      pkg.getRels(master).items.find((x) => x.type === REL_TYPES.theme).target,
    ),
    theme = pkg.getPart(themeName);
  theme.data = new TextEncoder().encode(
    new TextDecoder()
      .decode(theme.data)
      .replace('val="A3648B"', 'val="208F42"'),
  );
  expect(decodeURIComponent(preview(target, slide))).not.toContain(
    'fill="#EDE0E8"',
  );
  expect(preview(target, P.getSlides(target)[0])).toBe(other);
});

it("resolves layout decoration summaries against their own master theme", async () => {
  let source = await backgroundThemeFixture();
  const pkg = source[INTERNAL_PACKAGE],
    layout = P.getSlideLayout(P.getSlides(source)[0]),
    part = pkg.getPart(P.getSlideLayoutPartName(layout));
  const shape =
    '<p:sp><p:nvSpPr><p:cNvPr id="5" name="Theme decoration"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="570000" y="830000"/><a:ext cx="2200000" cy="490000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent5"/></a:solidFill><a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></a:ln></p:spPr></p:sp>';
  part.data = new TextEncoder().encode(
    new TextDecoder()
      .decode(part.data)
      .replace("</p:spTree>", shape + "</p:spTree>"),
  );
  source = await parseDeck(await P.savePresentation(source));
  const target = createDeck("blank"),
    sourceSlide = P.getSlides(source)[0],
    copied = copy(target, sourceSlide),
    read = (p, s) => P.getSlideLayoutBackgroundShapes(p, P.getSlideLayout(s));
  expect(read(source, sourceSlide)).toHaveLength(1);
  expect(read(target, copied)).toEqual(read(source, sourceSlide));
  expect(preview(target, copied)).toBe(preview(source, sourceSlide));
});
