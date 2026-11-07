import { describe, expect, it } from "vitest";
import { P, createDeck } from "../src/model.js";
import { sharedFontDescriptors } from "../lib/pptx/src/api/fn/shared-font-descriptors.ts";
import { NS } from "../lib/pptx/src/internal/xml/index.ts";
const enc = new TextEncoder();
const descriptor = (family, attrs) =>
  `<alias:sldLayout xmlns:alias="${NS.pml}" xmlns:d="${NS.dml}"><alias:cSld><alias:spTree><alias:sp><alias:txBody><d:bodyPr/><d:lstStyle><d:defPPr><d:defRPr><d:latin typeface="${family}" ${attrs}/></d:defRPr></d:defPPr></d:lstStyle></alias:txBody></alias:sp></alias:spTree></alias:cSld></alias:sldLayout>`;
const setup = () => {
  const pres = createDeck("blank"),
    pkg = P._internalPackageOf(pres);
  const parts = P.getSlideLayouts(pres).map((l) =>
    pkg.getPart(P.getSlideLayoutPartName(l)),
  );
  return { pkg, parts };
};
describe("source font descriptor resources", () => {
  it("retains consensus attributes across alias namespaces, escaped names, missing and unspecified fields", () => {
    const { pkg, parts } = setup();
    parts[0].data = enc.encode(
      descriptor(
        "Shared&#32;Face",
        'pitchFamily="0" panose="00000000000000000000"',
      ),
    );
    parts[1].data = enc.encode(
      descriptor(
        "SHARED FACE",
        'pitchFamily="18" panose="0202060305040502030a" charset="0"',
      ),
    );
    parts[2].data = enc.encode(
      descriptor("Shared Face", 'panose="0202060305040502030A"'),
    );
    expect(sharedFontDescriptors(pkg).get("shared face")).toEqual({
      pitchFamily: "18",
      panose: "0202060305040502030A",
      charset: "0",
    });
  });
  it("omits conflicting attributes while preserving the others", () => {
    const { pkg, parts } = setup();
    parts[0].data = enc.encode(
      descriptor("Conflict", 'pitchFamily="18" charset="0"'),
    );
    parts[1].data = enc.encode(
      descriptor("Conflict", 'pitchFamily="34" charset="0"'),
    );
    expect(sharedFontDescriptors(pkg).get("conflict")).toEqual({
      charset: "0",
    });
  });
  it("ignores foreign font elements, geometry, theme placeholders and malformed unused parts", () => {
    const { pkg, parts } = setup();
    parts[0].data = enc.encode(descriptor("+mj-lt", 'pitchFamily="18"'));
    parts[1].data = enc.encode(
      `<p:sldLayout xmlns:p="${NS.pml}" xmlns:a="${NS.dml}" xmlns:f="urn:foreign"><p:cSld><p:spTree><p:sp><p:spPr><a:latin typeface="Geometry" pitchFamily="18"/></p:spPr><p:txBody><f:latin typeface="Foreign" pitchFamily="18"/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    );
    parts[2].data = enc.encode('damaged XML pitchFamily="18"');
    expect([...sharedFontDescriptors(pkg)]).toEqual([]);
  });
  it("invalidates on added, removed and edited parts while isolating packages and not changing bytes", () => {
    const { pkg, parts } = setup(),
      other = setup();
    parts[0].data = enc.encode(descriptor("Changed", 'pitchFamily="18"'));
    const before = pkg.save();
    const hints = sharedFontDescriptors(pkg);
    expect(hints.get("changed").pitchFamily).toBe("18");
    expect(sharedFontDescriptors(pkg)).toBe(hints);
    expect(pkg.save()).toEqual(before);
    parts[0].data = enc.encode(descriptor("Changed", 'pitchFamily="34"'));
    expect(sharedFontDescriptors(pkg).get("changed").pitchFamily).toBe("34");
    expect(sharedFontDescriptors(other.pkg).get("changed")).toBeUndefined();
    pkg.removePart(parts[0].name);
    expect(sharedFontDescriptors(pkg).get("changed")).toBeUndefined();
    pkg.addPart(parts[0].name, parts[0].contentType, parts[0].data);
    expect(sharedFontDescriptors(pkg).get("changed").pitchFamily).toBe("34");
  });
});
