import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { geometryImage } from "./geometry-fixture.js";
import { resolveTarget, partName } from "../lib/pptx/src/internal/opc/index.ts";
import { P, createDeck, parseDeck } from "../src/model.js";
import { paintStyleFixture } from "./paint-style-copy-fixture.js";
import {
  NS,
  parseXml,
  firstChildElement,
  qname,
  getAttrValue,
} from "../lib/pptx/src/internal/xml/index.ts";
const child = (el, name) =>
  el && firstChildElement(el, qname("a", name, NS.dml));
const properties = (sh) =>
  firstChildElement(
    parseXml(P.getShapeXmlString(sh)).root,
    qname("p", "spPr", NS.pml),
  );
const val = (el, name) => el && getAttrValue(el, qname("", name, ""));
const copied = (
  source,
  target = createDeck(),
  options = { preservePaintFormatting: true },
) => {
  const slide = P.importSlide(
    target,
    source.slide,
    P.getSlideLayouts(target)[0],
    options,
  );
  return {
    pres: target,
    slide,
    shape: P.getSlideShapes(slide).find(
      (sh) => P.getShapeId(sh) === P.getShapeId(source.shape),
    ),
  };
};
const paint = (f) => ({
  fill: P.getShapeFillEffective(f.pres, f.shape),
  stroke: P.getShapeStrokeEffective(f.pres, f.shape),
  effects: P.getShapeEffectsEffective(f.pres, f.shape),
});

describe("source DrawingML paint across copy boundaries", () => {
  it("treats a malformed local width as unspecified while retaining the valid ancestor width", async () => {
    const source = await paintStyleFixture({
        local:
          '<a:ln w="invalid"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>',
        layout: '<a:ln w="24680"/>',
      }),
      c = copied(source);
    expect(P.getShapeStrokeEffective(source.pres, source.shape).widthEmu).toBe(
      24680,
    );
    expect(P.getShapeStrokeEffective(c.pres, c.shape).widthEmu).toBe(24680);
    expect(P.getShapeXmlString(source.shape)).toContain('w="invalid"');
  });
  it("uses the owning master theme and retains extension namespace scope", async () => {
    const source = await paintStyleFixture({
        layout:
          '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="65000"/></a:schemeClr></a:solidFill><a:ln w="12345"><a:noFill/><a:extLst><a:ext uri="urn:paint"><custom:descriptor xmlns:custom="urn:paint:custom" face="custom:Paint"/></a:ext></a:extLst></a:ln>',
      }),
      pkg = P._internalPackageOf(source.pres),
      theme = pkg.parts.find(
        (p) => p.name.includes("/theme/") && p.name.endsWith(".xml"),
      );
    pkg.addPart(
      "/ppt/theme/owner.xml",
      theme.contentType,
      strToU8(strFromU8(theme.data).replaceAll("315E87", "A45C38")),
    );
    const master = P.getSlideMasterPartName(source.slide),
      rels = pkg.getRels(master);
    rels.items.find((r) => r.type.endsWith("/theme")).target =
      "../theme/owner.xml";
    pkg.setRels(master, rels);
    const c = copied(source),
      color = child(child(properties(c.shape), "solidFill"), "srgbClr");
    expect(val(color, "val")).toBe("A45C38");
    expect(val(child(color, "lumMod"), "val")).toBe("65000");
    const ext = child(
      child(child(properties(c.shape), "ln"), "extLst"),
      "ext",
    ).children.find((c) => c.kind === "element");
    expect(ext.name.namespaceURI).toBe("urn:paint:custom");
    expect(ext.prefixDecls.get("custom")).toBe("urn:paint:custom");
    expect(val(ext, "face")).toBe("custom:Paint");
  });
  it.each(["<a:effectLst/>", "<a:effectDag/>"])(
    "an explicit %s blocks inherited effects in reads and copies",
    async (local) => {
      const source = await paintStyleFixture({
        local,
        layout:
          '<a:effectLst><a:glow rad="300000"><a:srgbClr val="CC0044"/></a:glow></a:effectLst>',
      });
      expect(P.getShapeEffectsEffective(source.pres, source.shape)).toEqual([]);
      const c = copied(source);
      expect(P.getShapeEffectsEffective(c.pres, c.shape)).toEqual([]);
      expect(
        child(
          properties(c.shape),
          local.includes("effectDag") ? "effectDag" : "effectLst",
        ),
      ).toBeTruthy();
    },
  );
  it("keeps gradient inheritance atomic stop lists and independent line choices", async () => {
    const source = await paintStyleFixture({
      local:
        '<a:gradFill><a:lin ang="7200000"/></a:gradFill><a:ln cap="flat"><a:custDash><a:ds d="30000" sp="60000"/></a:custDash><a:bevel/></a:ln>',
      layout:
        '<a:gradFill rotWithShape="0"><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:srgbClr val="EFEDDB"/></a:gs></a:gsLst><a:lin ang="10800000" scaled="1"/></a:gradFill><a:ln w="20222"><a:noFill/><a:prstDash val="dash"/><a:round/></a:ln>',
    });
    const c = copied(source),
      sp = properties(c.shape),
      grad = child(sp, "gradFill"),
      ln = child(sp, "ln");
    expect(val(grad, "rotWithShape")).toBe("0");
    expect(val(child(grad, "lin"), "ang")).toBe("7200000");
    expect(val(child(grad, "lin"), "scaled")).toBe("1");
    expect(
      child(grad, "gsLst").children.filter((c) => c.kind === "element"),
    ).toHaveLength(2);
    expect(child(ln, "prstDash")).toBeNull();
    expect(child(ln, "round")).toBeNull();
    expect(child(ln, "custDash")).toBeTruthy();
    expect(child(ln, "bevel")).toBeTruthy();
  });
  it.each(["0", "1000", "99999", "-1", "not-an-index"])(
    "tolerates fill style index %s without invalid choices or source edits",
    async (idx) => {
      const source = await paintStyleFixture({
          style: `<p:style><a:fillRef idx="${idx}"><a:schemeClr val="accent1"/></a:fillRef></p:style>`,
        }),
        before = P.getShapeXmlString(source.shape);
      const c = copied(source);
      expect(P.getShapeFillEffective(c.pres, c.shape)).toEqual({
        kind: "none",
      });
      expect(P.getShapeXmlString(source.shape)).toBe(before);
    },
  );
  it("keeps group paint for members using grpFill", async () => {
    const source = await paintStyleFixture({
      group: true,
      local: "<a:grpFill/>",
    });
    const pkg = P._internalPackageOf(source.pres),
      name = P.getSlidePartName(source.slide),
      part = pkg.getPart(name);
    part.data = strToU8(
      strFromU8(part.data).replace(
        /(<p:grpSpPr>[\s\S]*?)(<\/p:grpSpPr>)/g,
        '$1<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>$2',
      ),
    );
    const loaded = await parseDeck(await P.savePresentation(source.pres));
    // Re-read directly from the changed package bytes rather than stale shapes.
    const orig = { pres: loaded, slide: P.getSlides(loaded)[0] },
      root = P.getSlideShapes(orig.slide)[0];
    orig.shape = P.getGroupChildren(root)[0];
    const c = copied(orig),
      group = P.getSlideShapes(c.slide)[0],
      sp = firstChildElement(
        parseXml(P.getShapeXmlString(group)).root,
        qname("p", "grpSpPr", NS.pml),
      );
    expect(val(child(child(sp, "solidFill"), "srgbClr"), "val")).toBe("315E87");
    expect(child(properties(c.shape), "grpFill")).toBeTruthy();
  });
  it.each([false, true])(
    "rebinds layout/master paint relationships by owner across grouped=%s copies",
    async (group) => {
      const source = await paintStyleFixture({
          group,
          layout:
            '<a:blipFill><a:blip r:embed="rIdPaint"/><a:srcRect l="17000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>',
          master:
            '<a:effectDag><a:cont><a:fill><a:blipFill><a:blip r:embed="rIdPaint"/></a:blipFill></a:fill></a:cont></a:effectDag>',
        }),
        pkg = P._internalPackageOf(source.pres),
        layout = P.getSlideLayoutPartName(P.getSlideLayout(source.slide)),
        master = P.getSlideMasterPartName(source.slide);
      const masterImage = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0i8AAAAASUVORK5CYII=",
        "base64",
      );
      for (const [owner, name, data] of [
        [layout, "/ppt/media/layout-paint.png", geometryImage],
        [master, "/ppt/media/master-paint.png", masterImage],
      ]) {
        pkg.addPart(name, "image/png", new Uint8Array(data));
        const rels = pkg.getRels(owner);
        rels.items.push({
          id: "rIdPaint",
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
          target: name,
          targetMode: "Internal",
        });
        pkg.setRels(owner, rels);
      }
      // Both children use the same inherited image. Copy it once.
      P.copyShape(source.slide, source.shape);
      const c = copied(source),
        targetPkg = P._internalPackageOf(c.pres),
        rels = targetPkg.getRels(P.getSlidePartName(c.slide));
      const blip = child(child(properties(c.shape), "blipFill"), "blip"),
        rid = blip.attrs.find(
          (a) => a.name.namespaceURI === NS.officeDocRels,
        ).value;
      const rel = rels.items.find((r) => r.id === rid),
        image = targetPkg.getPart(
          resolveTarget(partName(P.getSlidePartName(c.slide)), rel.target),
        );
      expect(image.data).toEqual(new Uint8Array(geometryImage));
      expect(
        val(child(child(properties(c.shape), "blipFill"), "srcRect"), "l"),
      ).toBe("17000");
      expect(
        targetPkg.parts.filter((p) => p.name.includes("layout-paint")),
      ).toHaveLength(1);
      const masterBlip = child(
          child(
            child(
              child(child(properties(c.shape), "effectDag"), "cont"),
              "fill",
            ),
            "blipFill",
          ),
          "blip",
        ),
        masterRid = masterBlip.attrs.find(
          (a) => a.name.namespaceURI === NS.officeDocRels,
        ).value;
      expect(masterRid).not.toBe(rid);
      const masterRel = rels.items.find((r) => r.id === masterRid);
      expect(
        targetPkg.getPart(
          resolveTarget(
            partName(P.getSlidePartName(c.slide)),
            masterRel.target,
          ),
        ).data,
      ).toEqual(new Uint8Array(masterImage));
      expect(
        targetPkg.parts.filter((p) => p.name.includes("master-paint")),
      ).toHaveLength(1);
      const direct = P.copyShape(P.addBlankSlide(source.pres), source.root, {
        preservePaintFormatting: true,
      });
      const sh = group ? P.getGroupChildren(direct)[0] : direct;
      expect(child(properties(sh), "blipFill")).toBeTruthy();
    },
  );
  it.each(["picture", "shape"])(
    "keeps explicit no-fill/no-outline inherited by a %s",
    async (shapeKind) => {
      const source = await paintStyleFixture({ shapeKind }),
        destination = await paintStyleFixture({
          shapeKind,
          layout:
            '<a:solidFill><a:srgbClr val="DE1429"/></a:solidFill><a:ln w="300000"><a:solidFill><a:srgbClr val="F1A612"/></a:solidFill></a:ln>',
        });
      const c = copied(source, destination.pres);
      expect(paint(c)).toEqual(paint(source));
      if (shapeKind === "picture")
        expect(child(properties(c.shape), "noFill")).toBeTruthy();
      expect(child(child(properties(c.shape), "ln"), "noFill")).toBeTruthy();
    },
  );
  it.each(["315E87", "934F26"])(
    "retains a partial line, source theme color %s and raw attributes",
    async (color) => {
      const source = await paintStyleFixture({
        color,
        local:
          '<a:ln cap="flat"><a:solidFill><a:schemeClr val="accent1"><a:alpha val="42000"/><a:tint val="18000"/></a:schemeClr></a:solidFill></a:ln>',
        layout:
          '<a:ln w="67321" cmpd="dbl"><a:prstDash val="dash"/><a:round/><a:headEnd type="triangle" w="sm" len="lg"/></a:ln>',
      });
      const c = copied(source),
        ln = child(properties(c.shape), "ln");
      expect(val(ln, "w")).toBe("67321");
      expect(val(ln, "cap")).toBe("flat");
      expect(val(ln, "cmpd")).toBe("dbl");
      expect(val(child(ln, "prstDash"), "val")).toBe("dash");
      expect(val(child(ln, "headEnd"), "type")).toBe("triangle");
      const rgb = child(child(ln, "solidFill"), "srgbClr");
      expect(val(rgb, "val")).toBe(color);
      expect(val(child(rgb, "alpha"), "val")).toBe("42000");
      expect(val(child(rgb, "tint"), "val")).toBe("18000");
    },
  );
  it("retains master properties and an explicit empty effect list", async () => {
    const source = await paintStyleFixture({
      layout: "<a:effectLst/>",
      master:
        '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="13579"><a:solidFill><a:srgbClr val="142638"/></a:solidFill></a:ln><a:effectLst><a:glow rad="97531"><a:srgbClr val="FFDDAA"/></a:glow></a:effectLst>',
    });
    const c = copied(source),
      sp = properties(c.shape);
    expect(val(child(child(sp, "solidFill"), "srgbClr"), "val")).toBe("315E87");
    expect(val(child(sp, "ln"), "w")).toBe("13579");
    expect(child(sp, "effectLst").children).toHaveLength(0);
  });
  it("keeps default template adaptation unless paint preservation is requested", async () => {
    const source = await paintStyleFixture();
    expect(
      child(properties(copied(source, createDeck(), {}).shape), "noFill"),
    ).toBeNull();
  });
  it.each([false, true])(
    "survives two imports, nested group %s, same-package copying, editing and reload",
    async (group) => {
      const source = await paintStyleFixture({
          group,
          layout:
            '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="21234"><a:noFill/></a:ln><a:effectLst><a:softEdge rad="100000"/></a:effectLst>',
        }),
        before = unzipSync(await P.savePresentation(source.pres));
      const held = copied(source),
        pasted = copied(held),
        other = P.addBlankSlide(pasted.pres);
      const root = P.getSlideShapes(pasted.slide).find(
          (sh) => P.getShapeId(sh) === P.getShapeId(source.root),
        ),
        c = P.copyShape(other, root, { preservePaintFormatting: true });
      const shape = group ? P.getGroupChildren(c)[0] : c;
      expect(P.getShapeFillColorResolved(pasted.pres, shape)).toBe("#315E87");
      expect(val(child(properties(shape), "ln"), "w")).toBe("21234");
      expect(P.getShapeEffectsEffective(pasted.pres, shape)).toEqual([
        { kind: "softEdge", radiusEmu: 100000 },
      ]);
      P.setShapeStroke(shape, { color: "#426A59", widthEmu: 87654 });
      const loaded = await parseDeck(await P.savePresentation(pasted.pres)),
        last = P.getSlides(loaded).at(-1),
        edited = P.findShapeById(last, P.getShapeId(shape));
      expect(P.getShapeStrokeEffective(loaded, edited)).toMatchObject({
        kind: "solid",
        color: "#426A59",
        widthEmu: 87654,
      });
      const after = unzipSync(await P.savePresentation(source.pres));
      for (const name of Object.keys(before))
        expect(after[name]).toEqual(before[name]);
    },
  );
  it("preserves full style-matrix fills, outlines and effects with phClr transforms", async () => {
    const source = await paintStyleFixture({
      layout: "",
      style:
        '<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"><a:alpha val="45000"/></a:schemeClr></a:lnRef><a:fillRef idx="1001"><a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr></a:fillRef><a:effectRef idx="1"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"/></a:fontRef></p:style>',
      themeStyles:
        '<a:fmtScheme name="Paint"><a:fillStyleLst><a:noFill/></a:fillStyleLst><a:lnStyleLst><a:ln w="45678" cap="rnd"><a:solidFill><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:solidFill><a:prstDash val="sysDot"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:glow rad="34567"><a:schemeClr val="phClr"/></a:glow></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"><a:alpha val="75000"/></a:schemeClr></a:solidFill></a:bgFillStyleLst></a:fmtScheme>',
    });
    const c = copied(source),
      sp = properties(c.shape),
      ln = child(sp, "ln");
    expect(val(ln, "w")).toBe("45678");
    expect(val(ln, "cap")).toBe("rnd");
    const color = child(child(ln, "solidFill"), "srgbClr");
    expect(val(color, "val")).toBe("315E87");
    expect(
      color.children
        .filter((x) => x.kind === "element")
        .map((x) => x.name.localName),
    ).toEqual(["alpha", "shade"]);
    expect(val(child(child(sp, "solidFill"), "srgbClr"), "val")).toBe("315E87");
    expect(
      val(child(child(child(sp, "effectLst"), "glow"), "srgbClr"), "val"),
    ).toBe("315E87");
  });
});
