import { describe, expect, it } from "vitest";
import { OpcPackage } from "../lib/pptx/src/internal/parts/package.ts";
import { partName } from "../lib/pptx/src/internal/opc/index.ts";

const xmlType = "application/xml";
const bytes = (value) => new TextEncoder().encode(value);
const add = (pkg, name, value = "<part/>") =>
  pkg.addPart(partName(name), xmlType, bytes(value));
const get = (pkg, name) => pkg.getPart(partName(name));

describe("case-insensitive package part lookup", () => {
  it("preserves authored casing and finds equivalent names after save/load", () => {
    const pkg = OpcPackage.empty();
    const part = add(pkg, "/ppt/Slides/SlideA.XML");
    expect(get(pkg, "/PPT/SLIDES/SLIDEA.xml")).toBe(part);
    expect(get(pkg, "/ppt/slides/slidea.xml")).toBe(part);
    expect(part.name).toBe("/ppt/Slides/SlideA.XML");
    const reopened = OpcPackage.load(pkg.save());
    expect(get(reopened, "/PPT/SLIDES/SLIDEA.xml").name).toBe(part.name);
    expect(() => add(pkg, "/ppt/slides/SLIDEA.xml")).toThrow(/already exists/);
  });
  it("sees parts added and removed after hits and misses", () => {
    const pkg = OpcPackage.empty();
    expect(get(pkg, "/part.xml")).toBeNull();
    const first = add(pkg, "/Part.xml");
    expect(get(pkg, "/part.xml")).toBe(first);
    expect(pkg.removePart(partName("/PART.XML"))).toBe(true);
    expect(get(pkg, "/part.xml")).toBeNull();
    const next = add(pkg, "/part.xml", "<replacement/>");
    expect(get(pkg, "/PART.XML")).toBe(next);
  });
  it("honors current array order and direct replacement after prior lookups", () => {
    const pkg = OpcPackage.empty(),
      first = add(pkg, "/part.xml"),
      other = add(pkg, "/other.xml");
    expect(get(pkg, "/PART.XML")).toBe(first);
    const duplicate = {
      name: partName("/PART.XML"),
      contentType: xmlType,
      data: bytes("<duplicate/>"),
    };
    pkg.parts.unshift(duplicate);
    expect(get(pkg, "/part.xml")).toBe(duplicate);
    pkg.parts.reverse();
    expect(get(pkg, "/part.xml")).toBe(first);
    const replacement = { ...first, data: bytes("<replacement/>") };
    pkg.parts.splice(pkg.parts.indexOf(first), 1, replacement);
    expect(get(pkg, "/part.xml")).toBe(replacement);
    expect(get(pkg, "/other.xml")).toBe(other);
    pkg.parts.splice(0, pkg.parts.length);
    expect(get(pkg, "/part.xml")).toBeNull();
  });
  it("does not mutate parts and keeps their live content and identity", () => {
    const pkg = OpcPackage.empty(),
      part = add(pkg, "/part.xml");
    const ownKeys = Reflect.ownKeys(part);
    expect(get(pkg, "/PART.XML")).toBe(part);
    part.data = bytes("<updated/>");
    part.contentType = "custom/type";
    expect(get(pkg, "/PART.XML")).toBe(part);
    expect(new TextDecoder().decode(get(pkg, "/part.xml").data)).toBe(
      "<updated/>",
    );
    expect(Reflect.ownKeys(part)).toEqual(ownKeys);
    Object.freeze(part);
    expect(get(pkg, "/PART.XML")).toBe(part);
  });
  it("handles caller changes to a part's name without retaining stale aliases", () => {
    const pkg = OpcPackage.empty(),
      part = add(pkg, "/old.xml");
    expect(get(pkg, "/OLD.XML")).toBe(part);
    // JavaScript clients can replace even a TypeScript-readonly property.
    part.name = partName("/Renamed.XML");
    expect(get(pkg, "/old.xml")).toBeNull();
    expect(get(pkg, "/renamed.xml")).toBe(part);
  });
  it("keeps packages with the same names independent", () => {
    const first = OpcPackage.empty(),
      second = OpcPackage.empty();
    const a = add(first, "/part.xml", "<first/>"),
      b = add(second, "/part.xml", "<second/>");
    expect(get(first, "/PART.XML")).toBe(a);
    expect(get(second, "/PART.XML")).toBe(b);
    first.removePart(partName("/part.xml"));
    expect(get(first, "/part.xml")).toBeNull();
    expect(get(second, "/part.xml")).toBe(b);
  });
  it.each([
    ["/Ü.XML", "/ü.xml"],
    ["/İ.xml", "/i̇.XML"],
    ["/%C3%9C.xml", "/%c3%9c.XML"],
  ])("preserves existing case folding for %s", (name, query) => {
    const pkg = OpcPackage.empty(),
      part = add(pkg, name);
    expect(get(pkg, query)).toBe(part);
  });
});
